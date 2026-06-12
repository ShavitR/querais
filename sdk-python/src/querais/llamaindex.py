"""LlamaIndex integration: the OFFICIAL ``OpenAILike`` pointed at a QueraIS gateway.

Nothing is reimplemented — the gateway speaks the OpenAI protocol, so the genuine
LlamaIndex class works as-is. Requires the optional extra::

    pip install 'querais[llamaindex]'
"""

from __future__ import annotations

from typing import Any


def llm(base_url: str, *, api_key: str, model: str, **kwargs: Any) -> Any:
    """A ``llama_index.llms.openai_like.OpenAILike`` configured for the gateway.

    ``is_chat_model`` defaults to True (the gateway serves chat completions).
    Extra ``kwargs`` (temperature, max_tokens, …) pass straight through.
    """
    try:
        from llama_index.llms.openai_like import OpenAILike
    except ImportError as err:  # pragma: no cover - exercised via the extra
        raise ImportError(
            "LlamaIndex support needs the optional extra: pip install 'querais[llamaindex]'"
        ) from err
    kwargs.setdefault("is_chat_model", True)
    return OpenAILike(
        api_base=f"{base_url.rstrip('/')}/v1",
        api_key=api_key,
        model=model,
        **kwargs,
    )
