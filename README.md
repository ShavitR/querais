# QueraIS

**BitTorrent for AI inference.** An OpenAI-compatible API served by independent GPU nodes that
earn `$QAIS` for running LLM jobs. Every job settles on-chain — **95% to the node, 5% protocol fee**.

> ⚠️ **Testnet only** (Arbitrum Sepolia) — tokens have **no real value**. Your prompts run on
> strangers' machines and ~5% are re-run for verification, so **don't send anything secret**.
> [Terms](docs/TERMS.md) · [Privacy](docs/PRIVACY.md).

| You want to… | Do this | Time |
|---|---|---|
| 🤖 **Use the AI** from your code | [Path 1](#1--use-the-ai-from-your-code) | 2 min |
| 💸 **Earn `$QAIS`** with your GPU | [Path 2](#2--run-a-node-earn-qais) | 5 min |
| 🛠️ **Hack on the code** | [Path 3](#3--run-everything-locally) | 5 min |

---

## 1 · Use the AI from your code

**Step 1 — get an API key.** [Open an issue](https://github.com/ShavitR/querais/issues) or ask in
the project channel (operator-issued during beta; self-serve signup is coming).

**Step 2 — install the OpenAI client** (the gateway is a drop-in replacement):

```bash
pip install openai        # Python
npm i openai              # or TypeScript
```

**Step 3 — change one line** (the base URL) **and run:**

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

**Done.** Your prompt was served by an independent GPU node and the job settled on-chain —
watch it live at [querais-gateway.fly.dev/status](https://querais-gateway.fly.dev/status).
`GET /v1/models` lists what's currently served.

**Optional upgrades:**

```bash
pip install querais       # typed Python client + LangChain/LlamaIndex extras
npm i -g @querais/sdk     # TS client + `querais` CLI:  querais chat "Hello" · querais nodes
```

<details>
<summary><strong>Pay once, run thousands of jobs (batched settlement)</strong></summary>

By default a paid job costs an on-chain tx. Instead: deposit `$QAIS` into `CreditAccount`
**once**, sign **one** EIP-712 spending cap (zero gas), then fire unlimited jobs — the gateway
settles them in one `batchSettle` tx. The cap is the hard ceiling on what can ever be spent;
your principal can't be touched beyond it.

```ts
import { QueraisClient } from '@querais/sdk';

const client = new QueraisClient({
  baseUrl: 'http://127.0.0.1:8787',
  apiKey: 'sk-querais-dev',
  privateKey: '0x…',            // requester wallet — used ONCE to sign the cap, off-chain
});

// (1) Deposit $QAIS into the CreditAccount on-chain — GET /v1/credit/info for the address.
// (2) Open a session: sign the spending cap (zero gas) and register it.
await client.openSession({
  maxSpendWei: 10n ** 21n,                              // 1000 QAIS ceiling for this session
  nonce: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

// (3) From now on, jobs from this key settle in batches — no per-call wallet tx.
const r = await client.chat([{ role: 'user', content: 'Hi' }], { model: 'gemma3:4b' });
```

Proven in `pnpm test:e2e`: 100 calls → 1 on-chain tx → 0 requester wallet txs, 95/5 split lands.

</details>

---

## 2 · Run a node, earn $QAIS

You need: a machine with **Node.js ≥ 22.13** and **[Ollama](https://ollama.com)**. That's it —
the node generates its own encrypted wallet, auto-funds itself from the faucet (gas + stake),
and connects **outbound** (no ports to open, no Docker, no manual funding).

**Step 1 — download** `querais-node-vX.Y.Z.tar.gz` + `SHA256SUMS` from
[Releases](https://github.com/ShavitR/querais/releases), check it, unpack it:

```bash
sha256sum -c SHA256SUMS                 # must say OK
tar xzf querais-node-v*.tar.gz && cd querais-node-v*/
```

**Step 2 — run the launcher from a terminal, twice** (first run creates `.env` and stops, second
run starts the node):

**Linux / macOS:**

```bash
./run-node.sh
./run-node.sh
```

**Windows** — open **PowerShell** (Start → type `PowerShell`) and run it there; **don't
double-click** the file, or Windows just shows a "How do you want to open it?" dialog. The `.\`
prefix is required:

```powershell
.\run-node.ps1
.\run-node.ps1
```

> If PowerShell says *"running scripts is disabled on this system,"* run it this way instead (no
> settings change): `powershell -ExecutionPolicy Bypass -File .\run-node.ps1`

(The generated `.env` already points at the hosted gateway. Optionally edit `DAEMON_MODELS`
first to pick which Ollama models you serve.)

**Step 3 — confirm it worked.** The logs must print, in order:

```
node ready on-chain  →  connected to gateway  →  handshake accepted by gateway
```

**Done.** Your node now competes for jobs and earns the **95% provider share** of every job it
serves. Full walkthrough with screenshots-level detail: [`docs/NODE_RELEASE_INSTALL.md`](docs/NODE_RELEASE_INSTALL.md).

<details>
<summary><strong>Alternative installs (from source · Docker · one-liner)</strong></summary>

**From source** (clone this repo first; replace `GATEWAY_HOST` with the gateway's address):

```powershell
./scripts/setup-node.ps1 -Gateway ws://GATEWAY_HOST:8787/node   # Windows: install + build + pull model
./scripts/start-node.ps1
```

```bash
./scripts/setup-node.sh ws://GATEWAY_HOST:8787/node             # Linux / macOS
./scripts/start-node.sh
```

**Docker:** `scripts/install-node.sh` + `docker-compose.yml`.
**One-liner (Windows):** set `$env:QUERAIS_GATEWAY`, then `irm <raw-url>/scripts/bootstrap.ps1 | iex`.

</details>

---

## 3 · Run everything locally

You need: **Node.js ≥ 22.13** (`node -v` to check — older fails with `node:sqlite` errors),
**pnpm ≥ 9** (`npm i -g pnpm`), and **[Ollama](https://ollama.com)** running (`ollama serve`).

**Step 1 — clone, install, build:**

```bash
git clone https://github.com/ShavitR/querais && cd querais
pnpm install
pnpm build
```

**Step 2 — run the self-contained demo** (local chain + contracts + gateway + node + a real
streamed completion + live dashboard):

```bash
pnpm demo
```

**Step 3 — confirm it worked.** Tokens stream in the terminal, the on-chain protocol fee prints,
and a dashboard opens at `http://127.0.0.1:8787/` — try your own prompts there.

**Prove the whole protocol without a browser** (no Ollama needed — uses a mock backend):

```bash
pnpm test:e2e     # own chain, 18 end-to-end scenarios: settlement, slashing, disputes,
                  # batched settlement, treasury sweep+burn, staking, alerts, model manifest
```

<details>
<summary><strong>Run each piece in its own terminal (for development)</strong></summary>

```bash
# one-time
pnpm install && pnpm build
cp .env.example .env          # defaults are Hardhat dev accounts — fine for localhost

pnpm chain                    # terminal 1 — local blockchain
pnpm deploy:local             # terminal 2 — deploy all contracts
pnpm dev:gateway              # terminal 3 — OpenAI API on http://127.0.0.1:8787, dashboard at /
pnpm dev:daemon               # terminal 4 — a node (needs Ollama)
```

Then point any OpenAI client at `http://127.0.0.1:8787/v1` with key `sk-querais-dev` — same
code as [Path 1](#1--use-the-ai-from-your-code), different URL.

> **Which API key?** Whatever the gateway was configured with: `pnpm dev:gateway` reads
> `GATEWAY_API_KEYS` from `.env` (default `sk-querais-dev`); `pnpm gateway:sepolia` uses
> `sk-host`; `pnpm demo` uses `sk-test`.

</details>

<details>
<summary><strong>Host your own public gateway on Sepolia</strong></summary>

The contracts are already deployed — you reuse them:

```bash
cp .env.example .env          # fill DEPLOYER_PRIVATE_KEY + ARBITRUM_SEPOLIA_RPC_URL
pnpm gateway:sepolia          # binds 0.0.0.0:8787, enables the faucet (gas + QAIS drip)
```

It prints the host IPs, the node WS endpoint, the API key (`sk-host`), and the one firewall
command to open port 8787. Nodes join with the Path-2 scripts pointed at
`ws://<your-host>:8787/node`. `pnpm prepare:vm-node` pre-funds a node key for a second machine.

Deploying contracts yourself instead: `pnpm deploy:sepolia` (full suite) or
`pnpm deploy:credit:sepolia` (add only `CreditAccount`). Both write to
`packages/contracts/deployments/addresses.arbitrumSepolia.json`.

</details>

---

## If something breaks

| Symptom | Fix |
|---|---|
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Your Node is < 22.13 — upgrade. The #1 setup failure. |
| Imports / `pnpm demo` fail right after clone | You skipped `pnpm build`. Run it once — packages import each other's `dist/`. |
| `.env` ignored | Notepad saved it as `.env.txt` or with a BOM. Use `cp .env.example .env`. |
| Ollama errors in the demo | Start `ollama serve`; pull the model (`ollama pull gemma3:4b`, ~3.3 GB). Low RAM ⇒ slow (swap). |
| git-bash on Windows acting weird | Use forward-slash paths (`/c/Users/...`) — git-bash drops `cd C:\...` silently. PowerShell is first-class here. |

---

## Going deeper

<details>
<summary><strong>How a request flows</strong></summary>

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
4. **Settlement** runs the escrow path or the batched path. On a verification failure the
   requester is fully refunded and the provider's reputation drops + its stake is slashed.

</details>

<details>
<summary><strong>All commands</strong></summary>

```bash
# setup & quality
pnpm install              # install the workspace
pnpm build                # build every package (contracts: compile + export ABIs + tsc)
pnpm typecheck            # type-check everything
pnpm format               # prettier --write .   (run before lint)
pnpm lint                 # eslint + prettier --check
pnpm test                 # all unit tests (mock backend — no Ollama needed)
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

</details>

<details>
<summary><strong>Repository layout</strong></summary>

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

</details>

<details>
<summary><strong>Deployed contracts (Arbitrum Sepolia)</strong></summary>

`chainId 421614` — committed in `packages/contracts/deployments/addresses.arbitrumSepolia.json`.

| Contract | Address | Role |
|----------|---------|------|
| QUAISToken        | `0x5532663d4d4560d9923e30fb7230b82edcb25531` | ERC-20 `$QAIS` (fixed supply, burnable) |
| NodeRegistry      | `0xe9674474f7450b8fdc88895f7646d0d5fc34e99a` | node registration, staking, reputation |
| JobEscrow         | `0x9a8be9ad9f980e828757163780aea1ca46303267` | per-job lock + 95/5 settlement |
| CreditAccount     | `0xc148e3d305a35876d9df211dbc9ef944ab4c8191` | deposits + EIP-712 caps + batched settlement |
| DisputeResolution | `0x546b548bf5401aad0a21e85ce750aad5e58d8013` | commit-reveal arbitration + slashing |
| ProtocolTreasury  | `0x83acf7b9a8182a6398c1fd80d0e237011e903fa2` | fee accrual + 60/20/20 sweep + burn |
| StakingRewards    | `0x8fa6ec119ae18f0793d1ec0eb0525e9f6f6b648f` | staker reward distribution |

All are OpenZeppelin-based (`AccessControl`, `ReentrancyGuard`, `SafeERC20`, `Pausable`) and
verified on the block explorer. The manifest is the source of truth — the code reads it via
`loadAddresses()`, so always trust the JSON over any address copy-pasted elsewhere.

</details>

<details>
<summary><strong>Trust & security model</strong></summary>

This is **Phase 1: hybrid hub-and-spoke**. One trusted **gateway** does matching, holds the
`ORACLE` / `MATCHING_ENGINE` / `SLASHER` / `SETTLER` roles, and pays settlement gas.

- **What the gateway can't do:** steal deposited principal. It can only settle jobs at the
  prices the node agreed to, and batched settlement is bounded by the requester's *signed* cap.
- **What protects providers:** token counts are `min(node, gateway)`; bad results are slashed.
- **Layer-A semantic verification exists but is operator-gated and centralized:** the gateway
  oracle re-runs ~5% of jobs and flags anomalies, but it's off unless `GATEWAY_ORACLE_OLLAMA_URL`
  is set, and the oracle is the gateway itself — not yet a decentralized committee.
- **What's deliberately deferred:** removing the trusted gateway (libp2p mesh + on-chain auction
  + decentralized oracle), the full dispute-arbitration UX, and prompt privacy. These are Phase
  4/5 — see [What's not built yet](#whats-not-built-yet-limitations) and the design docs.

**Contracts** follow checks-effects-interactions on every fund-moving function, use custom
errors and a strict job state machine, and are covered by a comprehensive Solidity test suite
including a reentrancy-attacker mock, fuzzed conservation invariants, EIP-712 signature/replay
guards, and a gas-per-job benchmark. **Slither** static analysis runs in CI as a non-gating job
(it uses a scratch-dir workaround because crytic-compile can't yet drive Hardhat 3; triage lives
in `packages/contracts/slither.config.json`). Before any **mainnet** use: an external audit,
clearing the Slither baseline, and the Phase-2 decentralization work.

</details>

<a id="project-status"></a>

<details>
<summary><strong>Project status — 10 build slices shipped</strong></summary>

| Slice | What it delivers | Status |
|------|------------------|--------|
| 0 | CI green-bar gate (build · typecheck · lint · test · e2e) + Solidity lint + Slither | ✅ |
| 1 | Durable gateway state on `node:sqlite` (API keys, faucet claims, job history) | ✅ |
| 2 | **Batched settlement** — deposit once, sign one EIP-712 cap, settle thousands of jobs per tx | ✅ |
| 3 | Hardened surface (quotas, faucet anti-drain, WS flood caps) + ops (pause CLI, cold-key split) | ✅ |
| 4 | **5-dimension reputation** (accuracy/uptime/latency/longevity/stake) + daily on-chain snapshots | ✅ |
| 5 | **Layer-A semantic verification** (~5% sampled) + on-chain disputes with slashing | ✅ |
| 6 | **Tokenomics live**: ProtocolTreasury 60/20/20 sweep + burn, StakingRewards, incentives | ✅ |
| 7 | Production deploy — gateway **live 24/7 at `querais-gateway.fly.dev`** | ✅ |
| 8 | Observability: alerts + runbooks, review queue, metrics, public `/status` page | ✅ |
| 9 | DX & release: signed model manifest, npm/PyPI SDKs, prebuilt node releases, disclosures | ✅ |

The loop works both ways — **inference** (OpenAI request → match → real Ollama inference →
streamed result) and **settlement** (per-job escrow or batched, 95/5, with staking, slashing,
reputation). Next: Stage D (web app, arbitration panel, scale, mainnet gate). Live detail in
`HANDOFF.md`.

</details>

<details>
<summary><strong>All project docs</strong></summary>

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

</details>

---

## What's not built yet (limitations)

Honest edges — today's system works end-to-end, but it is **Phase 1**:

- **Self-serve API keys** — keys are operator-issued during the beta; no signup portal yet.
- **A trusted gateway, not a mesh** — one gateway does matching, settlement, and holds the
  oracle/slasher roles. The decentralized libp2p mesh + on-chain auction is Phase 4.
- **Verification is partial.** Layer-B (structural) always runs. Layer-A (semantic re-run
  sampling) exists but is off unless the operator configures an oracle endpoint — and the oracle
  is the gateway, not a committee. No GPU attestation.
- **Disputes are on-chain but bare** — `DisputeResolution` is deployed and wired, but there's no
  arbitrator-facing UI yet.
- **No prompt privacy.** Plaintext to independent operators; ~5% re-run on verification infra.
  No encryption / TEE. Don't send secrets.
- **No web app.** The only UI is the gateway-served dashboard (`/`) and `/status`.
- **One inference backend** — Ollama. vLLM is designed-for but not implemented.
- **Testnet only.** No token launch, no real value, no mainnet until an external audit, a clean
  Slither baseline, and Phase-2 decentralization. Release archives ship `SHA256SUMS` but aren't
  code-signed yet.

---

*QueraIS is testnet software under active development. No token has launched and nothing here
has real-world monetary value.*
