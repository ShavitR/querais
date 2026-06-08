# QueraIS — MVP

A runnable, end-to-end vertical slice of **QueraIS**, a decentralized P2P marketplace
for AI inference compute. A requester submits an OpenAI-compatible prompt → the gateway
matches it to a node → the node runs **real inference** (via Ollama) → the result streams
back → payment **settles on-chain** with a 95% provider / 5% protocol split.

> This is an MVP slice — a complete *loop*, not a complete *product*. See
> `*.md` design docs in this folder for the full vision, and
> `~/.claude/plans/foamy-riding-badger.md` for the build plan.

## Stack

- **TypeScript** everywhere (gateway, matching, node daemon, SDK) — pnpm workspaces, ESM, strict.
- **Solidity** contracts (`QUAISToken`, `NodeRegistry`, `JobEscrow`) on a local **Hardhat** chain.
- **Ollama** as the inference backend (abstracted so llama.cpp/vLLM can slot in later).

## Prerequisites

- Node.js ≥ 20 (developed on v26), `pnpm` (`npm i -g pnpm`)
- [Ollama](https://ollama.com) running locally with a model pulled, e.g. `ollama pull qwen3:1.7b`

## Layout

```
packages/
  contracts/    Solidity + Hardhat (deploy writes ABIs + addresses to exports/)
  shared/       @querais/shared — types, schemas, jobId, pricing, chain bindings (pure)
  matching/     @querais/matching — pure provider scorer/selection (never touches chain)
  gateway/      @querais/gateway — Fastify OpenAI-compatible API + dispatcher + settlement
  node-daemon/  @querais/node-daemon — provider: registers, runs inference, reports
  sdk/          @querais/sdk — OpenAI-shaped client + `querais` CLI
  test-e2e/     @querais/test-e2e — whole-slice acceptance harness + demo
apps/
  dashboard/    read-only React UI (live nodes, jobs, balances)
```

## Common scripts

```bash
pnpm install          # install workspace
pnpm build            # build all packages
pnpm lint             # eslint + prettier check
pnpm test             # all package tests
pnpm chain            # start local Hardhat node            (M1+)
pnpm deploy:local     # deploy contracts to local chain     (M1+)
pnpm dev:gateway      # run the gateway                     (M4+)
pnpm dev:daemon       # run a node daemon                   (M3+)
pnpm test:e2e         # full end-to-end acceptance test     (M6)
pnpm demo             # human-visible end-to-end demo        (M6)
```

## Quickstart (full demo)

```bash
pnpm install
ollama pull gemma3:4b      # one-time, if not already pulled
pnpm demo                  # spins up chain + contracts + gateway + node, runs a
                           # real streaming completion, prints the dashboard URL
```

Open the printed dashboard URL to watch live nodes, the treasury balance, and try
your own prompts. `pnpm test:e2e` runs the self-contained acceptance gate (success +
failure settlement paths) without needing a browser.

## Use it from your code (OpenAI drop-in)

Point the **official OpenAI client** at the gateway — change one line (the base URL):

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-querais-dev")
r = client.chat.completions.create(model="gemma3:4b",
    messages=[{"role": "user", "content": "Hello"}])
print(r.choices[0].message.content)
```

```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://127.0.0.1:8787/v1', apiKey: 'sk-querais-dev' });
const r = await client.chat.completions.create({
  model: 'gemma3:4b',
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(r.choices[0].message.content);
```

Or the bundled `querais` CLI (`@querais/sdk`):

```bash
querais chat "Hello"   # streams a completion
querais models         # models available on the network
querais nodes          # active nodes + reputation
```

Drop-in compatibility is enforced by the e2e suite, which runs the real `openai` SDK
against the gateway (buffered + streaming + `models.list()`).

## Join the public testnet

> Hub-and-spoke testnet (everything routes through a hosted gateway). Testnet only —
> **no real value**. Replace `GATEWAY_URL` below with the deployed gateway's address.

### Run a node (earn testnet QAIS)
Requires Docker. The node connects out to the gateway (no inbound ports) and generates
an encrypted wallet on first run.

```bash
# Linux/macOS
./scripts/install-node.sh
# Windows (PowerShell)
./scripts/install-node.ps1
```

Then fund the printed node address and let it auto-register:
```bash
docker compose logs node | grep "node ready on-chain"   # shows your node wallet
# 1) get a little Arbitrum Sepolia ETH (gas) from a public faucet
# 2) get QAIS to stake from the QueraIS faucet:
curl -X POST GATEWAY_URL/v1/faucet -H 'content-type: application/json' \
  -d '{"address":"0xYOURNODEADDRESS"}'
```

### Use the API (as a developer)
Get an API key + starter QAIS from onboarding, then point the OpenAI client at the
gateway (`GATEWAY_URL/v1`) exactly as in the drop-in example above. Jobs are served by
whichever node wins the match and settle on Arbitrum Sepolia.

> Deploying the gateway itself (Dockerfiles in `packages/*/Dockerfile`, TLS, secrets) is
> an operator step — see the Dockerfiles and `docker-compose.yml`.

## How the slice works

1. A requester POSTs to `/v1/chat/completions` (OpenAI-compatible) with a Bearer API key.
2. The gateway normalizes it into a canonical `JobSpec` (deterministic `jobId`), then
   the matching engine scores the connected nodes (price + reputation) and picks one.
3. The gateway locks the requester's `$QAIS` in `JobEscrow` (`createJob` → `assignJob`).
4. The chosen node runs **real inference** (Ollama) and streams tokens back; the gateway
   proxies them to the requester and counts them independently.
5. **Layer-B verification** checks the result (non-empty, length, no loops, and that the
   provider's `resultHash` matches exactly what was forwarded).
6. On pass, settlement is atomic: **95% to the provider, 5% to the treasury, remainder
   refunded**, the job is `VERIFIED`, and the node's reputation EMA updates. On fail, the
   requester is fully refunded.

## Security & production notes

The contracts follow a production-minded baseline — checks-effects-interactions on every
fund-moving function, OpenZeppelin `ReentrancyGuard` / `SafeERC20` / `AccessControl` /
`Pausable`, custom errors, and a strict job state machine — covered by 30 tests including a
reentrancy-attacker contract and fuzzed settlement invariants. Before any real deployment:
add a **Slither** pass and **coverage** in CI (current Hardhat 3 lacks a built-in coverage
task; revisit when the HH3 plugin lands), external audits, and replace the trusted-gateway
oracle/matching with the on-chain Phase-2 design (see the `querais_*.md` specs).

## Status

**MVP complete** — all 7 milestones (M0–M6) built and verified end-to-end: contracts
deployed + 30 tests; shared types; node daemon with live Ollama inference; gateway +
matching; on-chain settlement; and a self-contained e2e gate + live demo + dashboard.
