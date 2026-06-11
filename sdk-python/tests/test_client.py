"""QueraisClient unit tests on httpx.MockTransport — no network, no gateway."""

from __future__ import annotations

import json

import httpx
import pytest

from querais import ChatResult, QueraisClient, QueraisError

BASE = "https://gw.test"


def make_client(handler) -> QueraisClient:
    return QueraisClient(BASE, api_key="sk-test", transport=httpx.MockTransport(handler))


def test_chat_returns_content_usage_and_job_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer sk-test"
        body = json.loads(request.content)
        assert body["model"] == "mock-model"
        assert body["stream"] is False
        assert body["max_tokens"] == 32
        assert body["max_price_per_1k_tokens"] == 0.5  # QueraIS routing extension
        return httpx.Response(
            200,
            headers={"x-querais-job-id": "0xjob"},
            json={
                "choices": [{"message": {"role": "assistant", "content": "hello back"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
            },
        )

    with make_client(handler) as client:
        result = client.chat(
            [{"role": "user", "content": "hello"}],
            model="mock-model",
            max_tokens=32,
            max_price_per_1k_tokens=0.5,
        )
    assert result == ChatResult(
        content="hello back",
        usage={"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        job_id="0xjob",
    )


def test_chat_raises_typed_error_with_status_and_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            503, json={"error": {"message": "no capacity", "type": "no_eligible_nodes"}}
        )

    with make_client(handler) as client:
        with pytest.raises(QueraisError) as exc:
            client.chat([{"role": "user", "content": "hi"}], model="mock-model")
    assert exc.value.status == 503
    assert "no_eligible_nodes" in exc.value.body


def test_chat_stream_yields_deltas_and_skips_done_and_noise():
    sse = (
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'
        "data: \n\n"  # keep-alive
        'data: {"choices":[{"delta":{}}]}\n\n'  # finish frame, no content
        'data: {"choices":[{"delta":{"content":"lo!"}}]}\n\n'
        "data: [DONE]\n\n"
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(
            200, content=sse.encode(), headers={"content-type": "text/event-stream"}
        )

    with make_client(handler) as client:
        chunks = list(client.chat_stream([{"role": "user", "content": "hi"}], model="mock-model"))
    assert chunks == ["Hel", "lo!"]


def test_chat_stream_raises_on_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    with make_client(handler) as client:
        with pytest.raises(QueraisError) as exc:
            list(client.chat_stream([{"role": "user", "content": "hi"}], model="mock-model"))
    assert exc.value.status == 401


def test_models_nodes_stats_and_manifest():
    manifest = {
        "models": {"llama3.2": {"digest": "sha256:" + "a" * 64}},
        "signer": "0x" + "1" * 40,
        "signature": "0x" + "2" * 130,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        routes = {
            "/v1/models": {"object": "list", "data": [{"id": "llama3.2"}, {"id": "phi3"}]},
            "/v1/nodes": {"data": [{"wallet": "0xabc", "reputation": 0.71}]},
            "/v1/stats": {"jobs24h": 7, "nodes": 1},
            "/v1/models/manifest": manifest,
        }
        payload = routes.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=payload)

    with make_client(handler) as client:
        assert client.models() == ["llama3.2", "phi3"]
        assert client.nodes() == [{"wallet": "0xabc", "reputation": 0.71}]
        assert client.stats() == {"jobs24h": 7, "nodes": 1}
        assert client.model_manifest() == manifest


def test_model_manifest_404_when_gateway_unpinned():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "no model manifest configured"})

    with make_client(handler) as client:
        with pytest.raises(QueraisError) as exc:
            client.model_manifest()
    assert exc.value.status == 404
