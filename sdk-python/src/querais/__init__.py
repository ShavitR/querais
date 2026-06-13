"""QueraIS — Python client for the decentralized AI inference marketplace.

The gateway is OpenAI-compatible; this package is thin sugar plus QueraIS-specific
helpers. LangChain / LlamaIndex users: see ``querais.langchain`` /
``querais.llamaindex`` (optional extras).
"""

from .client import ChatResult, Message, QueraisClient, QueraisConnectionError, QueraisError

__version__ = "0.2.6"

__all__ = [
    "ChatResult",
    "Message",
    "QueraisClient",
    "QueraisConnectionError",
    "QueraisError",
    "__version__",
]
