"""Integration-module tests — skip cleanly when the optional extra isn't installed."""

from __future__ import annotations

import pytest


def test_langchain_chat_model_points_at_the_gateway():
    pytest.importorskip("langchain_openai")
    from querais.langchain import chat_model

    llm = chat_model("https://gw.test/", api_key="sk-test", model="llama3.2", temperature=0)
    # The official class, configured for the gateway (trailing slash normalized).
    assert type(llm).__name__ == "ChatOpenAI"
    assert llm.openai_api_base == "https://gw.test/v1"
    assert llm.model_name == "llama3.2"


def test_llamaindex_llm_points_at_the_gateway():
    pytest.importorskip("llama_index.llms.openai_like")
    from querais.llamaindex import llm

    model = llm("https://gw.test", api_key="sk-test", model="llama3.2")
    assert type(model).__name__ == "OpenAILike"
    assert model.api_base == "https://gw.test/v1"
    assert model.model == "llama3.2"
    assert model.is_chat_model is True
