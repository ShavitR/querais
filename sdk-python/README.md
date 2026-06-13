# querais

Python client for [QueraIS](https://github.com/ShavitR/querais) — the decentralized
AI inference marketplace. Anyone with a GPU serves models and earns; you buy
inference through one OpenAI-compatible endpoint.

```bash
pip install querais
```

```python
from querais import QueraisClient

client = QueraisClient("https://gateway.querais.xyz", api_key="sk-...")
result = client.chat([{"role": "user", "content": "hello"}], model="llama3.2")
print(result.content)
```

## OpenAI-compatible

The gateway speaks the OpenAI chat-completions protocol, so the official `openai`
package works too — point it at the gateway:

```python
from openai import OpenAI

client = OpenAI(base_url="https://gateway.querais.xyz/v1", api_key="sk-...")
```

This package is thin sugar over that protocol plus QueraIS-specific helpers.

## Streaming

```python
for delta in client.chat_stream([{"role": "user", "content": "tell me a story"}],
                                model="llama3.2"):
    print(delta, end="", flush=True)
```

## QueraIS extras

```python
client.models()          # model ids served by connected nodes
client.nodes()           # public node directory: reputation, prices, dimensions
client.stats()           # network stats
client.model_manifest()  # the gateway's signed model-digest manifest (404 if unpinned)
```

Routing extensions on `chat()` / `chat_stream()`:

```python
client.chat(messages, model="llama3.2",
            max_price_per_1k_tokens=0.5,  # cap what you pay
            min_reputation=0.7)           # floor the node quality
```

## LangChain / LlamaIndex

The integrations return the **official** LangChain / LlamaIndex OpenAI classes
configured for the gateway — nothing reimplemented:

```bash
pip install 'querais[langchain]'   # or 'querais[llamaindex]'
```

```python
from querais.langchain import chat_model
llm = chat_model("https://gateway.querais.xyz", api_key="sk-...", model="llama3.2")

from querais.llamaindex import llm as qllm
llm = qllm("https://gateway.querais.xyz", api_key="sk-...", model="llama3.2")
```

## License

MIT
