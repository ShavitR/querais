"""LangChain integration: the OFFICIAL ``ChatOpenAI`` pointed at a QueraIS gateway.

Nothing is reimplemented — the gateway speaks the OpenAI protocol, so the genuine
LangChain class works as-is. Requires the optional extra::

    pip install 'querais[langchain]'
"""

from __future__ import annotations

from typing import Any


def chat_model(base_url: str, *, api_key: str, model: str, **kwargs: Any) -> Any:
    """A ``langchain_openai.ChatOpenAI`` configured for the gateway.

    Extra ``kwargs`` (temperature, max_tokens, …) pass straight through.
    """
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as err:  # pragma: no cover - exercised via the extra
        raise ImportError(
            "LangChain support needs the optional extra: pip install 'querais[langchain]'"
        ) from err
    return ChatOpenAI(
        base_url=f"{base_url.rstrip('/')}/v1",
        api_key=api_key,
        model=model,
        **kwargs,
    )
