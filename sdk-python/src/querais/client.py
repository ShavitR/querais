"""Thin, typed client for the QueraIS gateway.

The gateway is OpenAI-compatible, so this is convenience sugar (exactly like the
TypeScript SDK): chat + SSE streaming plus QueraIS-specific helpers (nodes, stats,
model manifest). The official ``openai`` package also works against the gateway.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx

Message = dict[str, str]
"""An OpenAI-shaped chat message: ``{"role": "user", "content": "..."}``."""


class QueraisError(Exception):
    """A non-2xx response from the gateway (carries status + body text)."""

    def __init__(self, status: int, body: str):
        super().__init__(f"QueraIS gateway returned HTTP {status}: {body}")
        self.status = status
        self.body = body


class QueraisConnectionError(QueraisError):
    """The gateway host could not be reached at all (DNS / refused / timeout).

    A subclass of :class:`QueraisError` (so ``except QueraisError`` still catches it)
    with a legible message naming the URL, instead of leaking a raw ``httpx`` transport
    error. ``status`` is 0 — there was no HTTP response.
    """

    def __init__(self, base_url: str, cause: Exception):
        # Skip QueraisError's HTTP-status template — there is no HTTP response here.
        Exception.__init__(
            self,
            f"QueraIS: could not reach the gateway at {base_url} — "
            f"check it is running and the base_url is correct ({cause})",
        )
        self.status = 0
        self.body = str(cause)
        self.base_url = base_url


@dataclass
class ChatResult:
    """A buffered completion: the text, token usage, and the on-chain job id."""

    content: str
    usage: dict[str, int] = field(default_factory=dict)
    job_id: str | None = None


class QueraisClient:
    """Synchronous client for a QueraIS gateway.

    >>> client = QueraisClient("https://gateway.querais.xyz", api_key="sk-...")
    >>> result = client.chat([{"role": "user", "content": "hello"}], model="llama3.2")
    >>> print(result.content)

    ``transport`` is injectable for tests (``httpx.MockTransport``) — no network,
    no gateway needed.
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            headers={"authorization": f"Bearer {api_key}"},
            transport=transport,
        )

    # ── lifecycle ──────────────────────────────────────────────────────────────

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> QueraisClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ── chat ───────────────────────────────────────────────────────────────────

    def _chat_body(
        self,
        messages: list[Message],
        model: str,
        stream: bool,
        max_tokens: int | None,
        temperature: float | None,
        max_price_per_1k_tokens: float | None,
        min_reputation: float | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        # QueraIS routing extensions (ignored by other OpenAI-compatible servers).
        if max_price_per_1k_tokens is not None:
            body["max_price_per_1k_tokens"] = max_price_per_1k_tokens
        if min_reputation is not None:
            body["min_reputation"] = min_reputation
        return body

    def chat(
        self,
        messages: list[Message],
        *,
        model: str,
        max_tokens: int | None = None,
        temperature: float | None = None,
        max_price_per_1k_tokens: float | None = None,
        min_reputation: float | None = None,
    ) -> ChatResult:
        """Buffered chat completion."""
        res = self._request(
            "POST",
            "/v1/chat/completions",
            json=self._chat_body(
                messages,
                model,
                False,
                max_tokens,
                temperature,
                max_price_per_1k_tokens,
                min_reputation,
            ),
        )
        if res.status_code >= 400:
            raise QueraisError(res.status_code, res.text)
        data = res.json()
        choices = data.get("choices") or [{}]
        return ChatResult(
            content=(choices[0].get("message") or {}).get("content", ""),
            usage=data.get("usage") or {},
            job_id=res.headers.get("x-querais-job-id"),
        )

    def chat_stream(
        self,
        messages: list[Message],
        *,
        model: str,
        max_tokens: int | None = None,
        temperature: float | None = None,
        max_price_per_1k_tokens: float | None = None,
        min_reputation: float | None = None,
    ) -> Iterator[str]:
        """Streaming chat completion — yields content deltas as they arrive (SSE)."""
        body = self._chat_body(
            messages,
            model,
            True,
            max_tokens,
            temperature,
            max_price_per_1k_tokens,
            min_reputation,
        )
        try:
            with self._http.stream("POST", "/v1/chat/completions", json=body) as res:
                if res.status_code >= 400:
                    res.read()
                    raise QueraisError(res.status_code, res.text)
                for line in res.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        frame = json.loads(data)
                    except ValueError:
                        continue  # keep-alives / non-JSON frames
                    if not isinstance(frame, dict):
                        continue
                    # The gateway reports mid-stream failures (e.g. no eligible node) as an
                    # in-band error frame on an otherwise-200 stream — surface it instead of
                    # ending silently (the bare stream would just yield nothing and look
                    # like an empty reply). Mirrors the TypeScript SDK.
                    err = frame.get("error")
                    if err:
                        message = err.get("message") if isinstance(err, dict) else None
                        raise QueraisError(res.status_code, message or json.dumps(err))
                    delta = ((frame.get("choices") or [{}])[0].get("delta") or {}).get("content")
                    if delta:
                        yield delta
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise QueraisConnectionError(str(self._http.base_url), exc) from exc

    # ── QueraIS extras ─────────────────────────────────────────────────────────

    def models(self) -> list[str]:
        """Model ids currently served by at least one connected node."""
        data = self._get_json("/v1/models")
        return [m["id"] for m in data.get("data", [])]

    def nodes(self) -> list[dict[str, Any]]:
        """The public node directory: wallet, reputation, offers, dimensions."""
        return self._get_json("/v1/nodes").get("data", [])

    def stats(self) -> dict[str, Any]:
        """Network stats (jobs, volume, nodes)."""
        return self._get_json("/v1/stats")

    def model_manifest(self) -> dict[str, Any]:
        """The gateway's signed model manifest (Slice 9). Raises 404 when unpinned.

        The returned object is signed (EIP-191) by the gateway's settler address and
        can be verified offline — see ``GET /v1/credit/info`` for the settler.
        """
        return self._get_json("/v1/models/manifest")

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        """Send a request, rewriting a connection failure into a legible QueraIS error.

        ``httpx`` raises a raw ``ConnectError`` when the host is refused/unknown; we
        wrap it so the user sees which URL failed instead of a bare transport error.
        """
        try:
            return self._http.request(method, path, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise QueraisConnectionError(str(self._http.base_url), exc) from exc

    def _get_json(self, path: str) -> dict[str, Any]:
        res = self._request("GET", path)
        if res.status_code >= 400:
            raise QueraisError(res.status_code, res.text)
        return res.json()
