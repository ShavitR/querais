# QueraIS

**A decentralized, peer-to-peer marketplace for AI inference compute — "BitTorrent for AI."**
Anyone with a GPU can run a node and earn cryptocurrency by serving LLM inference; anyone who
needs AI compute buys it through an OpenAI-compatible API without going through a centralized
provider. Payment settles on-chain in the `$QAIS` token with a 95% provider / 5% protocol split.

This repository is a **real, working implementation** — not a mockup. The contracts are deployed
and verified on Arbitrum Sepolia, real `gemma3:4b` inference runs through it, and a job has
settled on-chain end-to-end across two machines.

> **Testnet only — no real value.** Everything runs on Arbitrum Sepolia (chainId `421614`).
> The current architecture is **hybrid hub-and-spoke** (a trusted gateway does matching and
> settlement); the fully decentralized mesh is a later phase. See the design docs below.
> By using the network you accept the [Terms of Service](docs/TERMS.md) — and read the
> [Privacy Notice](docs/PRIVACY.md) first: ~5% of prompts are re-run on verification
> infrastructure, and your prompts execute on independent operators' machines.

---

## Table of contents

1. [What works today](#what-works-today)
2. [Use the live testnet gateway (fastest path)](#use-the-live-testnet-gateway-fastest-path)
3. [Prerequisites](#prerequisites)
4. [60-second demo](#60-second-demo)
5. [Call it from your code (OpenAI drop-in)](#call-it-from-your-code-openai-drop-in)
6. [Batched settlement: pay once, run thousands of jobs](#batched-settlement-pay-once-run-thousands-of-jobs)
7. [Run the full stack manually](#run-the-full-stack-manually)
8. [Run a node and earn testnet QAIS](#run-a-node-and-earn-testnet-qais)
9. [Host your own gateway on Sepolia](#host-your-own-gateway-on-sepolia)
10. [How a request flows](#how-a-request-flows)
11. [Repository layout](#repository-layout)
12. [All commands](#all-commands)
13. [Deployed contracts](#deployed-contracts-arbitrum-sepolia)
14. [Trust & security model](#trust--security-model)
15. [Environment gotchas (read if something breaks)](#environment-gotchas-read-if-something-breaks)
16. [Project docs](#project-docs)

---

## What works today

The project is built in **slices** against `docs/EXECUTION_PLAN.md`. Done and merged:

| Slice | What it delivers | Status |
|------|------------------|--------|
| 0 | CI green-bar gate (build · typecheck · lint · test · e2e) + Solidity lint + Slither | ✅ |
| 1 | Durable gateway state on `node:sqlite` (API keys, faucet claims, job history) | ✅ |
| 2 | **Batched session-deposit settlement** — deposit once, sign one EIP-712 cap, settle thousands of jobs in one tx | ✅ |
| 3 | Hardened surface (quotas, faucet anti-drain, WS flood caps) + ops (pause CLI, cold-key split) | ✅ |
| 4 | Full **5-dimension reputation** (accuracy/uptime/latency/longevity/stake) + daily on-chain snapshots | ✅ |
| 5 | **Layer-A semantic verification** (oracle re-runs ~5% of jobs) + on-chain disputes with slashing | ✅ |
| 6 | **Tokenomics live**: ProtocolTreasury 60/20/20 sweep + burn, StakingRewards, node incentive programs | ✅ |
| 7 | Production deploy — the gateway is **live 24/7 at `querais-gateway.fly.dev`** | ✅ |
| 8 | Observability: alert webhook + runbooks, review queue, metrics, public `/status` page | ✅ |
| 9 | DX & release: signed model manifest, npm/PyPI-ready SDKs, prebuilt node releases, disclosures | ✅ |

The end-to-end loop works in both directions:

- **Inference**: OpenAI-compatible request → matching → real Ollama inference → streamed result.
- **Settlement**: per-job on-chain escrow **or** batched settlement against a pre-funded credit
  account — 95% provider / 5% treasury, with staking, slashing, and a reputation score.

Next up is Stage D (the web app, arbitration panel, scale, mainnet gate). See `HANDOFF.md`
for the live status.

---

## Use the live testnet gateway (fastest path)

A hosted gateway runs 24/7 at **`https://querais-gateway.fly.dev`** against the Arbitrum
Sepolia contracts. You need an **API key** (issued by the operator during the beta — the
self-serve portal is a later slice; ask in the project channel or open an issue). Then it's
the official OpenAI client with one changed line — nothing to clone, nothing to build:

**Python** (`pip install openai`):

```python
from openai import OpenAI

client = OpenAI(base_url="https://querais-gateway.fly.dev/v1", api_key="sk-...your key...")
stream = client.chat.completions.create(
    model="gemma3:4b",
    messages=[{"role": "user", "content": "Explain Arbitrum in one sentence."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**TypeScript** (`npm i openai`):

```ts
import OpenAI from 'openai';

const client = new OpenAI({ baseURL: 'https://querais-gateway.fly.dev/v1', apiKey: 'sk-…' });
const stream = await client.chat.completions.create({
  model: 'gemma3:4b',
  messages: [{ role: 'user', content: 'Explain Arbitrum in one sentence.' }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
```

Your prompt is matched to an independent GPU node, served with real local inference, and
the job settles on-chain — watch it live at
[`https://querais-gateway.fly.dev/status`](https://querais-gateway.fly.dev/status).
`GET /v1/models` lists what the connected nodes currently serve; there's also a
[Python SDK](sdk-python/) (`querais` on PyPI, with LangChain/LlamaIndex helpers) and a
[TS SDK + CLI](packages/sdk/) (`@querais/sdk`) if you want sessions and node/stats helpers.

> Want to **serve** jobs instead? Skip to [Run a node](#run-a-node-and-earn-testnet-qais) —
> a prebuilt release runs in ~5 minutes with just Node 22 + Ollama.

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| **Node.js** | **≥ 22.13** (dev on v26) | The toolchain uses Node's built-in `node:sqlite`, which is only stable from 22.13. Node 20 will fail at install with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. |
| **pnpm** | ≥ 9 (`npm i -g pnpm`) | Workspace package manager. |
| **Ollama** | latest | The inference backend. Install from [ollama.com](https://ollama.com) and make sure it's running (`ollama serve`). |

Check your Node version first: `node -v` — it must print `v22.13` or higher.

> The unit tests and the e2e gate use a **mock** inference backend, so you can run
> `pnpm test` / `pnpm test:e2e` **without Ollama**. You only need Ollama for `pnpm demo`
> and for running a real node.

---

## 60-second demo

This spins up a throwaway local blockchain, deploys all contracts, starts a gateway **and** a
node, runs a **real streaming completion**, prints the protocol fee earned on-chain, and leaves
a live dashboard open. Everything is self-contained on your machine.

```bash
pnpm install
pnpm build                 # compiles contracts + builds every package (required once)
ollama pull gemma3:4b      # ~3.3 GB; optional — the node auto-pulls it on first run anyway
pnpm demo
```

**What success looks like:** you'll see the prompt stream token-by-token in the terminal, a
line showing the on-chain treasury fee, and a dashboard URL like `http://127.0.0.1:8787/`.
Open it to watch live nodes, balances, and to try your own prompts in the browser.

Want just the automated proof, no browser? Run the acceptance gate:

```bash
pnpm test:e2e             # spins up its own chain, runs 18 end-to-end scenarios, tears down
```

It exercises (among others): successful settlement (95/5), a failed-verification refund +
slash, OpenAI-SDK parity, **batched settlement** (100 calls → 1 on-chain tx, 0 requester
wallet txs), the pause drill, reputation snapshots, Layer-A cheater detection, an on-chain
dispute slash, treasury sweep + burn, staking rewards, graceful drain, the alerting loop,
and the signed model manifest.

---

## Call it from your code (OpenAI drop-in)

The gateway is OpenAI-compatible — point the **official OpenAI client** at it and change one
line (the base URL). You need a gateway running with a node connected; the simplest way is the
[manual stack](#run-the-full-stack-manually) below (its API key is `sk-querais-dev`, from
`.env.example`).

**Python:**
```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-querais-dev")
r = client.chat.completions.create(
    model="gemma3:4b",
    messages=[{"role": "user", "content": "Explain Arbitrum in one sentence."}],
)
print(r.choices[0].message.content)
```

**TypeScript / JavaScript:**
```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://127.0.0.1:8787/v1', apiKey: 'sk-querais-dev' });
const r = await client.chat.completions.create({
  model: 'gemma3:4b',
  messages: [{ role: 'user', content: 'Explain Arbitrum in one sentence.' }],
});
console.log(r.choices[0].message.content);
```

Streaming (`stream: true`), `models.list()`, and the usage object all work — drop-in parity is
enforced by the e2e suite, which runs the real `openai` SDK against the gateway.

**Or the bundled `querais` CLI** (`@querais/sdk`):
```bash
querais chat "Hello"   # streams a completion
querais models         # models available on the network
querais nodes          # active nodes + their reputation
```

> **Which API key?** It's whatever the gateway was configured with.
> `pnpm dev:gateway` reads `GATEWAY_API_KEYS` from `.env` (default `sk-querais-dev`);
> `pnpm gateway:sepolia` uses `sk-host`; `pnpm demo` uses `sk-test`.

---

## Batched settlement: pay once, run thousands of jobs

By default every API call costs an on-chain transaction. **Batched settlement** removes that:
the requester deposits `$QAIS` into the `CreditAccount` contract **once**, signs a single
EIP-712 *spending cap* off-chain (zero gas), and then fires unlimited jobs. The gateway
accumulates the signed debits and settles them all in **one** `batchSettle` transaction — the
requester signs **nothing** per call, and the signed cap bounds the most the gateway could ever
spend (no way to touch your principal beyond the cap).

Using the SDK (the only extra requirement is a requester private key for the one signature):

```ts
import { QueraisClient } from '@querais/sdk';

const client = new QueraisClient({
  baseUrl: 'http://127.0.0.1:8787',
  apiKey: 'sk-querais-dev',
  privateKey: '0x…',            // requester wallet — used ONCE to sign the cap, off-chain
});

// (1) Deposit $QAIS into the CreditAccount on-chain — see GET /v1/credit/info for the address.
// (2) Open a session: sign a spending cap (zero gas) and register it.
await client.openSession({
  maxSpendWei: 10n ** 21n,                              // 1000 QAIS ceiling for this session
  nonce: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

// (3) From now on, jobs from this key settle in batches — no per-call wallet tx.
const r = await client.chat([{ role: 'user', content: 'Hi' }], { model: 'gemma3:4b' });
```

The gateway flushes a batch once enough jobs accumulate (`GATEWAY_BATCH_FLUSH_THRESHOLD`) or on
shutdown. Verified end-to-end in `pnpm test:e2e`: **10 jobs → 1 on-chain `batchSettle` → 0
requester transactions**, with the 95/5 split landing on-chain.

---

## Run the full stack manually

For development you can run each piece in its own terminal (so the gateway stays up for you to
hit from code). From the repo root:

```bash
# one-time
pnpm install && pnpm build
cp .env.example .env          # the defaults are Hardhat dev accounts — fine for localhost

# terminal 1 — local blockchain
pnpm chain

# terminal 2 — deploy all contracts to the local chain
pnpm deploy:local

# terminal 3 — the gateway (OpenAI API on http://127.0.0.1:8787, dashboard at /)
pnpm dev:gateway

# terminal 4 — a node daemon (needs Ollama running with the model)
pnpm dev:daemon
```

Now hit `http://127.0.0.1:8787/v1` with the [drop-in examples above](#call-it-from-your-code-openai-drop-in)
(key `sk-querais-dev`).

---

## Run a node and earn testnet QAIS

Join an existing network as a provider. The node generates an **encrypted wallet** on first
run, **auto-funds itself** (gas + stake) from the gateway's faucet, stakes, and registers — no
manual funding, no Docker required. It connects *out* to the gateway, so **no inbound ports** are
needed on your machine.

**Easiest: install from a release archive (no clone, no build).** Download
`querais-node-vX.Y.Z.tar.gz` from the GitHub Releases page, verify the checksum, extract,
and run the launcher — the whole daemon is bundled into one file. Full walkthrough:
[`docs/NODE_RELEASE_INSTALL.md`](docs/NODE_RELEASE_INSTALL.md). Requirements: **Node ≥ 22.13**
and **Ollama**, nothing else.

**From source** (this repo):

> Replace `GATEWAY_HOST` with the gateway operator's address. Your machine needs **Node ≥ 22.13**
> and **Ollama**; the setup script installs what's missing and pulls the model.

**Windows (PowerShell):**
```powershell
./scripts/setup-node.ps1 -Gateway ws://GATEWAY_HOST:8787/node   # install + build + pull model
./scripts/start-node.ps1                                        # run it
```

**Linux / macOS:**
```bash
./scripts/setup-node.sh ws://GATEWAY_HOST:8787/node
./scripts/start-node.sh
```

**Success =** the logs print `node ready on-chain` → `connected to gateway` →
`handshake accepted by gateway`. The faucet covers gas + stake automatically; from then on the
node competes for jobs and earns the 95% provider share of each one it serves.

> **Prefer Docker?** Use `scripts/install-node.sh` + `docker-compose.yml`.
> **Ultra one-liner** (once the repo is public): set `$env:QUERAIS_GATEWAY` then
> `irm <raw-url>/scripts/bootstrap.ps1 | iex` — clones, sets up, and starts in one shot.

---

## Host your own gateway on Sepolia

To operate a network others can join (the contracts are already deployed on Sepolia — you
reuse them):

```bash
cp .env.example .env          # then fill DEPLOYER_PRIVATE_KEY + ARBITRUM_SEPOLIA_RPC_URL
pnpm gateway:sepolia          # binds 0.0.0.0:8787, enables the faucet (gas + QAIS drip)
```

It prints the host IPs, the node WS endpoint, the API key (`sk-host`), and the one firewall
command to open port 8787. Nodes then join with the scripts above pointed at
`ws://<your-host>:8787/node`. `pnpm prepare:vm-node` helps pre-fund a node key for a second
machine / VM.

> Deploying the contracts yourself instead of reusing the existing ones:
> `pnpm deploy:sepolia` (full suite) or `pnpm deploy:credit:sepolia` (add only the
> `CreditAccount` to an existing deployment). Both write to
> `packages/contracts/deployments/addresses.arbitrumSepolia.json`.

---

## How a request flows

```
requester ──POST /v1/chat/completions──▶ gateway ──match──▶ node ──Ollama──▶ tokens
                                            │                                    │
                                            ◀──────────── streamed back ─────────┘
                                            │
                                            ├─ verify (Layer-B: non-empty, length,
                                            │   no loops, resultHash matches forwarded text)
                                            │
                                            └─ settle ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  No credit session  → JobEscrow: createJob → assignJob →            │
        │                        verifyAndRelease  (1 tx/job: 95% / 5% / refund)│
        │  Active credit session → record a signed debit; flush a batch of    │
        │                        them in ONE CreditAccount.batchSettle tx      │
        └───────────────────────────────────────────────────────────────────┘
```

1. The gateway authenticates the Bearer API key → requester wallet, normalizes the request into
   a canonical `JobSpec` (deterministic `jobId`), and the **pure matching engine** scores
   connected nodes on price + reputation and picks one.
2. The chosen node runs **real inference** (Ollama) and streams tokens; the gateway proxies them
   to the requester **and counts them independently** (it settles on `min(node, gateway)` — it
   never trusts the node's count alone).
3. **Layer-B verification** checks the output is non-empty, within length, loop-free, and that
   the provider's `resultHash` matches exactly what was forwarded.
4. **Settlement** runs the escrow path or the batched path (above). On a verification failure
   the requester is fully refunded and the provider's reputation drops + its stake is slashed.

---

## Repository layout

```
packages/
  contracts/    Solidity + Hardhat 3. contracts/*.sol; scripts/{deploy,deploy-credit-account,
                export-abis,preflight}.ts; deployments/addresses.<network>.json (sepolia
                committed); src/ builds dist/ exporting the ABIs + loadAddresses().
  shared/       @querais/shared — the cross-layer contract: types, zod schemas, deterministic
                jobId, pricing math, EIP-712 spending caps, the gateway↔node wire protocol,
                viem chain bindings. Pure (no chain at runtime except thin helpers).
  matching/     @querais/matching — pure provider scorer/selection (never touches the chain).
  gateway/      @querais/gateway — Fastify OpenAI-compatible API + dispatcher + settlement
                (per-job + batched) + node pool + verify + db/ (node:sqlite) + routes/.
  node-daemon/  @querais/node-daemon — the provider: encrypted keystore, auto-funding,
                auto-pricing, model auto-pull, auto-reconnect, real Ollama inference.
  sdk/          @querais/sdk — OpenAI-shaped client (+ openSession) and the `querais` CLI.
  test-e2e/     @querais/test-e2e — the 18-scenario acceptance gate, the demo, the release
                smoke, and the Sepolia ops scripts (gateway:sepolia, live:sepolia, …).
sdk-python/     querais on PyPI — QueraisClient + LangChain/LlamaIndex integration modules
                (own toolchain: ruff + pytest + build; not part of the pnpm workspace).
scripts/        bundle-daemon.mjs (release bundler) + release/ launchers + node setup scripts.
apps/
  dashboard/    placeholder — the live dashboard is served by the gateway itself at `/`.
docs/           EXECUTION_PLAN.md (the roadmap) · runbooks · TERMS/PRIVACY · release/observability docs
HANDOFF.md      current project status for the next contributor — read this first.
querais_*.md    the 7 original design/whitepaper documents (vision, architecture, tokenomics…).
```

---

## All commands

```bash
# setup & quality
pnpm install              # install the workspace
pnpm build                # build every package (contracts: compile + export ABIs + tsc)
pnpm typecheck            # type-check everything
pnpm format               # prettier --write .   (run before lint)
pnpm lint                 # eslint + prettier --check
pnpm test                 # all unit tests (uses a mock backend — no Ollama needed)
pnpm test:e2e             # self-contained 18-scenario end-to-end gate
pnpm test:coverage        # TS coverage report (non-gating)

# release artifacts
pnpm bundle:daemon        # esbuild the daemon into release/ (single file + tar.gz + SHA256SUMS)
pnpm smoke:bundle         # prove the bundled artifact serves a job on a local chain

# local chain & run
pnpm chain                # start a local Hardhat node
pnpm deploy:local         # deploy all contracts to the local chain
pnpm dev:gateway          # run the gateway (reads .env)
pnpm dev:daemon           # run a node daemon (reads .env; needs Ollama)
pnpm demo                 # the full self-contained demo + dashboard

# Arbitrum Sepolia (testnet)
pnpm deploy:sepolia       # deploy the full contract suite
pnpm deploy:credit:sepolia# add only CreditAccount to an existing deployment
pnpm gateway:sepolia      # run a public gateway on Sepolia (faucet on)
pnpm prepare:vm-node      # pre-fund a node key for a second machine

# Solidity-only
pnpm --filter @querais/contracts lint:sol   # solhint (also runs in CI)
```

**The green bar** = `build · typecheck · lint · test · test:e2e` all pass. CI
(`.github/workflows/ci.yml`) runs the same bar plus solhint on every PR; a PR must be green to
merge.

---

## Deployed contracts (Arbitrum Sepolia)

`chainId 421614` — committed in `packages/contracts/deployments/addresses.arbitrumSepolia.json`.

| Contract | Address | Role |
|----------|---------|------|
| QUAISToken    | `0x1e89e050e68e81c32980205ec0db444ede3f4e2c` | ERC-20 `$QAIS` (fixed supply, burnable) |
| NodeRegistry  | `0x6d13d0f94ef912c6817a74c632a378997eacf776` | node registration, staking, reputation |
| JobEscrow     | `0x60c87b02db5aabd27ff5f72a447b9fba4fbbd6b0` | per-job lock + 95/5 settlement |
| CreditAccount | `0x1e44f2ce56d90f764121b82bc3571b08a1d15522` | deposits + EIP-712 caps + batched settlement |

All are OpenZeppelin-based (`AccessControl`, `ReentrancyGuard`, `SafeERC20`, `Pausable`) and
verified on the block explorer.

---

## Trust & security model

This is **Phase 1: hybrid hub-and-spoke**. One trusted **gateway** does matching, holds the
`ORACLE` / `MATCHING_ENGINE` / `SLASHER` / `SETTLER` roles, and pays settlement gas.

- **What the gateway can't do:** steal deposited principal. It can only settle jobs at the
  prices the node agreed to, and batched settlement is bounded by the requester's *signed* cap.
- **What protects providers:** token counts are `min(node, gateway)`; bad results are slashed.
- **What's deliberately deferred:** removing the trusted gateway (libp2p mesh + on-chain auction
  + decentralized oracle), full dispute arbitration, semantic (Layer-A) verification, and prompt
  privacy. These are Phase 4/5 — see the design docs.

**Contracts** follow checks-effects-interactions on every fund-moving function, use custom
errors and a strict job state machine, and are covered by **48 Solidity tests** including a
reentrancy-attacker mock, fuzzed conservation invariants, EIP-712 signature/replay guards, and a
gas-per-job benchmark. Before any **mainnet** use: external audit, a Slither pass (currently
deferred — Hardhat 3 framework support is pending), and the Phase-2 decentralization work.

---

## Environment gotchas (read if something breaks)

- **`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`** → your Node is < 22.13. Upgrade. This is the
  single most common setup failure.
- **`.env` not loading** → if you created it with Notepad it may be saved as `.env.txt` with a
  BOM. Create it with `cp .env.example .env` (or save as UTF-8 without BOM).
- **Windows / PowerShell** is a first-class shell here. If you use the git-bash side, use
  forward-slash paths (`/c/Users/...`) — git-bash silently drops `cd C:\...`.
- **Ollama errors in the demo** → make sure `ollama serve` is running and the model is pulled
  (`ollama pull gemma3:4b`). On a low-RAM machine a 4B model leans on swap and is slow.
- **`pnpm demo` / imports fail right after clone** → you skipped `pnpm build`. The packages
  import each other's built `dist/`, so build once before running.

---

## Project docs

Read these for the full picture (in the repo root and `docs/`):

- **`HANDOFF.md`** — current status, what's built, how to run/verify, and the next milestone.
- **`docs/TERMS.md`**, **`docs/PRIVACY.md`** — terms of service and the privacy notice
  (what gets sampled for verification, what's hashed vs. stored). **`SECURITY.md`** — how to
  report vulnerabilities.
- **`docs/EXECUTION_PLAN.md`** — the live, slice-by-slice roadmap.
- **`docs/NODE_RELEASE_INSTALL.md`** — run a node from a prebuilt release in ~5 minutes.
- **`docs/BETA_PLAYBOOK.md`** — beta-cohort recruitment + leaderboard/competition campaign
  materials. **`docs/REPO_PUBLIC_CHECKLIST.md`** — the (irreversible) go-public gate.
- **`docs/SLICE1_PLAN.md`**, **`docs/SLICE2_PLAN.md`**, **`Slice8.md`**, **`Slice9.md`** —
  per-slice plans/records.
- **`querais_overview.md`**, **`querais_protocol_architecture.md`**, `querais_token_economics.md`,
  `querais_reputation_system.md`, `querais_smart_contracts.md`, `querais_node_design.md`,
  `querais_go_to_market.md` — the original vision and specifications.

---

*QueraIS is testnet software under active development. No token has launched and nothing here
has real-world monetary value.*
