# @querais/sdk

TypeScript client + CLI for [QueraIS](https://github.com/ShavitR/querais) — a
decentralized AI inference marketplace where independent GPU nodes serve your
requests and settle on-chain.

> **Testnet only — no real value.** By using the network you accept the
> [Terms](https://github.com/ShavitR/querais/blob/main/docs/TERMS.md); read the
> [Privacy Notice](https://github.com/ShavitR/querais/blob/main/docs/PRIVACY.md)
> first (~5% of prompts are re-run for verification; prompts execute on
> independent operators' machines).

## Install

```bash
npm install @querais/sdk
```

## Quickstart

```ts
import { QueraisClient } from '@querais/sdk';

const client = new QueraisClient({
  baseUrl: 'https://gateway.querais.xyz', // optional — this is the default
  apiKey: 'sk-querais-…', // issued by the gateway operator
});

// Buffered
const r = await client.chat([{ role: 'user', content: 'Explain Arbitrum in one sentence.' }], {
  model: 'gemma3:4b',
});
console.log(r.content, r.usage);

// Streaming
for await (const delta of client.chatStream([{ role: 'user', content: 'Hi' }], {
  model: 'gemma3:4b',
})) {
  process.stdout.write(delta);
}
```

### Already using the `openai` package?

The gateway is OpenAI-compatible — you don't need this SDK at all:

```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'https://gateway.querais.xyz/v1', apiKey: 'sk-…' });
```

This SDK adds the QueraIS-specific surface on top: marketplace routing options
(`maxPricePer1kTokens`, `minReputation`), node/stats introspection, and
batched-settlement sessions.

## Marketplace helpers

```ts
await client.models(); // model ids available on the network
await client.nodes(); // active nodes: wallet, reputation, models, prices
await client.stats(); // network totals
```

## Batched settlement (pay once, run thousands of jobs)

Deposit $QAIS into the CreditAccount contract once, sign **one** EIP-712
spending cap off-chain (zero gas), then fire unlimited jobs — the gateway
settles them in batches. The cap bounds the most it can ever spend.

```ts
const client = new QueraisClient({
  baseUrl: 'https://gateway.querais.xyz',
  apiKey: 'sk-…',
  privateKey: '0x…', // requester wallet — used ONCE, off-chain, to sign the cap
});

await client.openSession({
  maxSpendWei: 10n ** 21n, // 1000 QAIS ceiling for this session
  nonce: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

await client.chat([{ role: 'user', content: 'Hi' }], { model: 'gemma3:4b' });
await client.sessionStatus(); // cap, spend, credit balance, headroom
```

## CLI

The package ships a `querais` binary:

```bash
export QUERAIS_BASE_URL=https://gateway.querais.xyz
export QUERAIS_API_KEY=sk-…
export QUERAIS_MODEL=gemma3:4b

querais chat "Hello"   # streams a completion
querais models         # models available on the network
querais nodes          # active nodes + reputation
querais stats          # network stats
```

## Requirements

Node ≥ 22.13 (uses the global `fetch`).

## License

MIT — see the [repository](https://github.com/ShavitR/querais).
