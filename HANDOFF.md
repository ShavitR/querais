# QueraIS — Agent Handoff

You are picking up an in-progress project. Read this top-to-bottom once (~5 min), then use
the pointers to drill in. It captures what exists, how to run/verify it, the design rules
that matter, and the **environment traps** that already cost time — don't relearn them.

---

## 1. What this is (orientation)

**QueraIS** is a decentralized P2P marketplace for **AI inference compute** — "BitTorrent
for AI." Requesters submit OpenAI-compatible jobs; GPU node operators serve them with real
local LLM inference; payment settles in an ERC-20 token (`$QAIS`) on an L2, with a 5%
protocol fee, secured by node staking + slashing + reputation.

Current architecture is **hybrid hub-and-spoke** (the design docs' "Phase 1"): one trusted
**gateway** does matching + holds the ORACLE/MATCHING/SLASHER keys + pays settlement gas;
nodes and requesters all talk to it. It is **NOT** a P2P mesh yet (that's the future Phase 4).
Everything is on **Arbitrum Sepolia testnet — no real value.**

It is real and working: contracts are **deployed + verified on Arbitrum Sepolia**, and a
job has run **end-to-end across two machines** (a separate VM ran a node that served a real
`gemma3:4b` completion which settled on-chain).

---

## 2. The plan we're executing (READ THIS)

The live roadmap is **`docs/EXECUTION_PLAN.md`** — an opinionated, protocol-first sequence
(a companion to the broader catalogue in `docs/PHASE3_PLAN.md`; where they disagree on order,
the EXECUTION_PLAN wins). The thesis: **make the protocol complete/credible first, then operate
it as a hosted service.** Stages:

```
Stage A — Foundation        ✅ 0 CI gate   ✅ 1 Persistence   ✅ 2 Batched settlement   ⬜ 3 Harden surface ⭐
Stage B — Protocol depth    ⬜ 4 Reputation   ⬜ 5 Layer-A verify   ⬜ 6 Tokenomics
Stage C — Operate           ⬜ 7 Deploy   ⬜ 8 Observability   ⬜ 9 DX/node-polish/growth
```

**Working rhythm (established, stick to it):** one **branch + PR per slice**, gated by the
**green bar in CI**, squash-merged to `main`. Slices are split into tested increments
(e.g. Slice 1 shipped as 1A then 1B). Build a slice → full green bar → commit → PR → CI green
→ merge. Pause for review at each slice boundary.

**Slice 2 is DONE** (PRs #18 contract → #19 Sepolia deploy → #21 runtime). The marquee work
shipped: `CreditAccount.sol` (deposit → EIP-712 signed cap → `batchSettle([...])` →
withdraw-after-notice), the off-chain signed-debit ledger, and `BatchedSettlement implements
Settlement` with a dispatcher branch (deposited requesters skip per-job escrow; `ChainSettlement`
stays the fallback). e2e proves 10 jobs settle in **1** tx with **0** requester per-call txs.

**The immediate next milestone is Slice 3 — harden the open surface** (persistent IP+address
faucet throttle + daily cap, per-key quota tiers with 429s, prompt-abuse limits, WS flood caps,
a documented key-management + pause drill). See `docs/EXECUTION_PLAN.md` Slice 3.

---

## 3. Status: done / in-progress / deferred

**Built & verified (Phase 1 + "Plan A" packaging, then Slices 0–1 of the execution plan):**
- Contracts: `QUAISToken`, `NodeRegistry`, `JobEscrow` (+ `ReentrantToken` test mock).
  Deployed + Arbiscan-verified on Sepolia. 30 contract tests (conservation, access control,
  reentrancy, fuzz, full node lifecycle). **Unchanged by Slices 0–1.**
- `@querais/shared`: canonical `JobSpec` + deterministic `jobId`, OpenAI schemas, gateway↔node
  wire protocol, pricing (basis-point) math, viem chain bindings. 16 tests.
- `@querais/matching`: pure scorer (0.5·price + 0.5·reputation), never touches chain. 6 tests.
- `@querais/node-daemon`: real **Ollama** inference, encrypted **keystore**, **auto-pricing**,
  **model auto-pull**, **auto-reconnect**, **auto-faucet self-funding**. 19 tests.
- `@querais/gateway`: OpenAI-compatible Fastify API, matching, on-chain settlement (95/5 +
  reputation EMA), **slashing on bad results**, rate limiting, `/metrics`, served **dashboard**.
  **Now with durable state (Slice 1) — see §3a.** 22 tests.
- `@querais/sdk`: OpenAI-shaped client + `querais` CLI. 5 tests.
- `@querais/test-e2e`: a **6-scenario** acceptance gate + live/ops scripts. The `ops` scenario
  now also asserts the persisted `/v1/jobs/:id` + `/v1/usage` routes end-to-end.
- Dumb-proof node onboarding: `scripts/setup-node.*` + `start-node.*`. Docker path also exists.

**Slice 0 — CI + static analysis (DONE, merged #1):**
- `.github/workflows/ci.yml`: **green-bar** job (build/typecheck/lint/test/test:e2e, blocking),
  **solhint** (blocking Solidity lint), **coverage** + **pnpm audit** (non-gating). Runs on
  Ubuntu, Node 22, pnpm 11.5.2; seeds `.env` from `.env.example`; e2e is self-contained.
- `.github/dependabot.yml`: monthly, grouped, **npm majors ignored** (handled deliberately);
  action bumps grouped. CI actions pinned to **v6**.
- **Slither was deferred** (documented): driving solc directly under pnpm trips solc
  `--allow-paths` on the symlinked `.pnpm` store, and its framework auto-detect doesn't support
  Hardhat 3. solhint covers the blocking Solidity gate; revisit Slither in Slice 2.
- **Contract-line coverage deferred** (no HH3-compatible tool yet). TS coverage is reported.

**Slice 1 — durable gateway state (DONE, merged #15) — see §3a.**

**Slice 2 — batched session-deposit settlement (DONE, merged #18/#19/#21):**
- `CreditAccount.sol` (new, additive — deployed + Arbiscan-verified on Sepolia; existing 3
  contracts untouched): `deposit` → EIP-712 `SpendingCap` (signed once off-chain, zero gas) →
  `batchSettle([...])` paying 95/5 in ONE tx → withdraw-after-notice. `SETTLER_ROLE`-gated; the
  signed cap bounds worst-case exposure (no principal theft). 18 contract tests + gas benchmark
  (~36k gas/job for a 20-job batch). First EIP-712 in the repo.
- `@querais/shared/spending-cap.ts`: EIP-712 domain/types + viem sign/recover/hash + wire schema
  + `buildSignedSession` (the SDK's one-call signer). Re-exported via the barrel.
- Gateway: migration 3 adds `credit_sessions` + `debit_entries`; `SessionStore` (one active cap
  per requester) + `DebitLedgerStore` (durable pending debits). `BatchedSettlement implements
  Settlement` accrues a signed debit per job and flushes ALL of a requester's debits in one
  `batchSettle` tx at `batchFlushThreshold` (or on shutdown), updating reputation once per
  provider per flush. **Dispatcher branches**: active session → skip `createJob`/`assignJob`,
  settle batched; else the unchanged escrow path. New `POST /v1/sessions` + `GET /v1/credit/info`.
- SDK: optional `privateKey` + `openSession()` (signs the cap, zero gas) + `creditInfo()`.
- New e2e scenario `runBatchedSettlementCase`: 10 jobs → 1 `batchSettle` tx, 0 requester txs,
  95/5 verified on-chain. 7 e2e scenarios total. New env var: **`GATEWAY_BATCH_FLUSH_THRESHOLD`**.
- Reputation is still per-flush-per-provider (not the full snapshotted multi-dimensional score —
  that's Slice 4). Detail in `docs/SLICE2_PLAN.md`.

**Deferred (do NOT assume these exist):**
- Slices 3–9 of the execution plan (harden surface, reputation completeness, Layer-A verify,
  tokenomics, hosted deploy, SRE, DX/growth).
- **Phase 4/5**: libp2p / on-chain auction / decentralized oracle (remove the trusted gateway),
  full `DisputeResolution` arbitration, TEE prompt privacy, mainnet/TGE, DAO.
- The dependency **majors** (zod 4, openai 6, typescript 6, @types/node 25, eslint 10, pino 10,
  globals 17, dotenv 17) — deliberately deferred; Dependabot no longer auto-proposes them.

### 3a. What Slice 1 added (gateway persistence)

The gateway used to lose all state on restart (API keys in a JSON file, faucet claims in an
in-memory `Set`, no job history). Slice 1 makes it durable behind a thin repository seam:

- **`packages/gateway/src/db/`**: `GatewayDb` (one shared **`node:sqlite`** connection +
  `user_version` migration runner), and `JobStore`. **Zero new runtime deps** — `node:sqlite`
  is built into Node ≥22.13 (synchronous, no native build).
- `ApiKeyStore` + `Faucet` are DB-backed (public methods unchanged → routes untouched). The
  faucet's reserve is now an **atomic `INSERT` on a PRIMARY KEY**, so the one-per-address Sybil
  throttle **survives restart** (the old `Set` was re-claimable by bouncing the process).
- **Job records** persisted from the dispatcher at assign/settle/fail (writes are **non-fatal**
  — a DB hiccup never breaks/unsettles a paid job). **Usage is derived** by aggregating settled
  rows (no second table). `GET /v1/jobs/:id` is enriched; new `GET /v1/usage`.
- **Design constraint (load-bearing):** the DB is the coordinator's **operational cache/index,
  NEVER the source of truth for value/trust** — that stays on-chain. Kept thin/dismantlable for
  Phase 4. See `docs/SLICE1_PLAN.md`.
- New env var: **`GATEWAY_DB_PATH`** (a SQLite file path; unset = in-memory, used by tests/e2e
  so they stay self-contained). The old `GATEWAY_API_KEY_STORE` / `apiKeyStorePath` is gone.

---

## 4. Repo layout (pnpm monorepo, TypeScript ESM)

```
packages/
  contracts/    Solidity + Hardhat 3. contracts/*.sol, scripts/{deploy,export-abis,preflight}.ts
                deployments/addresses.<network>.json (sepolia committed, localhost gitignored)
                .solhint.json (lint:sol) ; src/ → built dist/ exports ABIs + loadAddresses()
  shared/       @querais/shared — types/schemas/jobId/pricing/wire/chain (the cross-layer contract)
  matching/     @querais/matching — pure provider selection (no viem at runtime)
  gateway/      @querais/gateway — src/{server,dispatcher,node-pool,settlement,verify,chain-client,
                key-store,faucet,metrics,config,auth}.ts + routes/* + db/{index,migrations,jobs}.ts
  node-daemon/  @querais/node-daemon — src/{daemon,gateway-client,registry,keystore,pricing,
                auto-fund,report,config}.ts + inference/{backend,ollama,mock}.ts
  sdk/          @querais/sdk — client.ts + cli.ts
  test-e2e/     harness.ts + e2e.ts + run-e2e.ts (+ demo, live-sepolia, gateway-sepolia, prepare-vm-node)
apps/dashboard/ placeholder (the live dashboard is served by the gateway at `/`)
.github/        workflows/ci.yml + dependabot.yml   (Slice 0)
docs/EXECUTION_PLAN.md   the live, protocol-first roadmap (what we're following)
docs/SLICE1_PLAN.md      Slice 1 detail (the thin-DB principle + node:sqlite rationale)
docs/PHASE3_PLAN.md      the broader workstream catalogue (P3.1–P3.14)
querais_*.md             the 7 original design/whitepaper docs — read for intent
```

**Most load-bearing files:** `packages/contracts/contracts/JobEscrow.sol` (escrow + 95/5
settlement), `packages/shared/src/jobspec.ts` (canonical spec + jobId), `packages/gateway/src/
dispatcher.ts` (match → lock/assign → stream → verify → settle → persist), `packages/gateway/
src/settlement.ts` (the `Settlement` seam — Slice 2 adds `BatchedSettlement` here),
`packages/gateway/src/db/*` (Slice 1 persistence), `packages/node-daemon/src/inference/ollama.ts`,
`packages/test-e2e/src/e2e.ts` (the acceptance scenarios).

---

## 5. Job lifecycle (how a request flows)

1. `POST /v1/chat/completions` (Bearer API key → requester wallet via `ApiKeyStore`, now DB-backed).
2. Gateway normalizes → canonical `JobSpec` (`jobId = keccak256(canonical bytes)`).
3. `matching.selectBest()` picks a node from the in-memory pool (price + reputation).
4. Gateway (MATCHING_ENGINE) `createJob` (locks QAIS) → `assignJob` on-chain. **Job row persisted.**
5. Node runs **real inference** (Ollama), streams tokens over WS; gateway proxies + **counts
   tokens independently** (settles on `min(node, gateway)` — trust-minimized).
6. **Layer-B verify** (`verify.ts`): non-empty, length, no loops, and `resultHash ==
   hash(forwarded text)`. (Deliberately **no cross-node hash matching** — see §6.)
7. Settle: `completeJob` → `verifyAndRelease` (95/5 + reputation EMA) on success; `failJob`
   refund + slash on failure. **Job row updated** (status + settlement split); **usage derived**
   from settled rows. (`Settlement` interface; `ChainSettlement` impl; Slice 2 adds batching.)

---

## 6. Design rules that MUST hold (don't "fix" these)

- **No cross-node output hashing for verification.** `temperature=0` is NOT deterministic
  across GPUs/backends; hash-matching honest nodes would falsely slash them. Verification is
  **Layer-B (objective checks) + economic staking**, with Layer-A (semantic similarity sampling)
  as the future Slice 5. `resultHash` only pins a node to *what it sent the gateway*.
- **Token count = `min(node-reported, gateway-counted)`** (never trust the node alone).
- **Job deadlines derive from CHAIN time** (`block.timestamp`), not wall-clock — Hardhat drifts
  the block clock under bursty load and `createJob` checks `deadline > block.timestamp`.
- **All fee/price math is integer wei + basis points** (no floats on-chain). Float USD→wei
  conversion happens once, off-chain, in `shared/src/pricing.ts`.
- **Contracts**: CEI on every fund-moving fn, OZ `ReentrancyGuard`/`SafeERC20`/`AccessControl`/
  `Pausable`, custom errors, strict job state machine. `JobEscrow` is the job registry.
- **`matching` stays pure** (no viem/chain at runtime) so it can move on-chain in Phase 4.
- **The gateway DB is a thin cache/index, never the source of truth for value/trust** — that
  stays on-chain. Persistence writes are non-fatal; keep the DB minimal/dismantlable. (Slice 1.)
- Keep changes **additive via the existing seams**: `Settlement`, `InferenceBackend`,
  `ApiKeyStore`, `FaucetDistributor`, `GatewayDb`/`JobStore`, `loadAddresses(network)`, the WS transport.

---

## 7. Run & verify (commands)

From the repo root (PowerShell). **Always `Set-Location C:\Users\mynew\Desktop\querais` first
if a previous Hardhat command ran — see §8.**

```
pnpm install              # esbuild build is allow-listed in pnpm-workspace.yaml
pnpm build               # builds all packages (contracts = hardhat compile + export-abis + tsc)
pnpm typecheck
pnpm lint                # eslint + prettier --check  (run `pnpm exec prettier --write .` first!)
pnpm test                # all unit tests (~90+)
pnpm test:e2e            # self-contained: spawns a fresh local chain, deploys, runs 6 scenarios
pnpm demo                # local human demo (real Ollama + dashboard)
pnpm --filter @querais/contracts lint:sol   # solhint (also runs in CI)
```
Local chain manually: `pnpm chain` (terminal 1) + `pnpm deploy:local` (terminal 2).
Sepolia: `pnpm preflight:sepolia` → `pnpm deploy:sepolia` → verify cmds it prints.
Run hosted on Sepolia: `pnpm gateway:sepolia` (binds 0.0.0.0:8787) + a node via
`scripts/setup-node.*` then `scripts/start-node.*`. `pnpm prepare:vm-node` auto-funds a node key.

**Green bar = build + typecheck + lint + test + test:e2e all pass.** That's the bar before any
commit. **CI runs the same bar on every PR** (`.github/workflows/ci.yml`) + solhint; a PR must
be green to merge. Verified empirically: CI goes red on a failing test, green on a clean PR.

---

## 8. Environment traps (these already cost time)

- **Node ≥ 22.13 is REQUIRED** (`engines.node`), not the old `>=20`. pnpm 11.5.2 imports
  `node:sqlite` (which Slice 1 also uses), absent before 22.13. Node 20 fails at install/CI
  setup with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. **Local dev uses Node 26; CI uses Node 22.**
- **Windows + PowerShell** is the shell. The **Bash tool is git-bash** — and it strips Windows
  backslash paths (`cd C:\...` silently fails); use forward-slash paths (`/c/Users/...`).
  PowerShell's `bash` is WSL and has **no distro** (fails).
- **CWD drift:** running Hardhat via pnpm leaves the PowerShell CWD in `packages/contracts`.
  Before any root-level `pnpm lint/test/build`, run `Set-Location C:\Users\mynew\Desktop\querais`.
- **Format before committing:** run `pnpm exec prettier --write .` then `pnpm lint`. Prettier
  checks YAML/JSON too (the CI workflow files), so format those after editing.
- **PowerShell here-strings mangle `git commit -m`** — use multiple `-m` flags. End every commit
  message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`.env` via Notepad becomes `.env.txt` + a BOM** → vars silently not loaded. Create `.env`
  with a PowerShell here-string `... | Out-File .env -Encoding ascii`, or set vars inline with `$env:`.
- **tsx isn't a bare command** — invoke via pnpm scripts or `pnpm --filter <pkg> exec tsx`.
- **Hardhat 3 specifics:** `defineConfig`, `network.connect()`, solc 0.8.28 (optimizer 200,
  evmVersion cancun), contract types from generated `artifacts/**`. No built-in coverage; Slither
  framework auto-detect doesn't support HH3 (see §3, Slice 0).
- **Ollama** is the inference backend (`gemma3:4b` + `qwen3:1.7b` pulled). qwen3 is a thinking
  model — the daemon sends `think:false`. Tests/e2e use the **MockBackend** (no Ollama needed).

---

## 9. On-chain deployment (Arbitrum Sepolia, chainId 421614)

Manifest: `packages/contracts/deployments/addresses.arbitrumSepolia.json` (committed).
- QUAISToken `0x1e89e050e68e81c32980205ec0db444ede3f4e2c`
- NodeRegistry `0x6d13d0f94ef912c6817a74c632a378997eacf776`
- JobEscrow `0x60c87b02db5aabd27ff5f72a447b9fba4fbbd6b0`
- CreditAccount `0x1e44f2ce56d90f764121b82bc3571b08a1d15522` (Slice 2; gateway holds SETTLER_ROLE)
- Deployer = admin = gateway = treasury = requester = `0xc80A8137E57D494b195EdA12f74d7Df324f5b9d6`
  (a single throwaway testnet wallet holding the 1B QAIS + all roles, for the hybrid setup).

Secrets live in `.env` (gitignored): `DEPLOYER_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_RPC_URL`,
`ETHERSCAN_API_KEY`, gateway/node/requester keys, `GATEWAY_DB_PATH` (optional). See `.env.example`
for every variable. **Never commit `.env`; never put real-value keys in it (testnet only).**

---

## 10. Trust model (important when changing security)

The gateway is **trusted**: it holds ORACLE+MATCHING+SLASHER roles, a gas wallet, and the
faucet distributor. Worst case if compromised is bounded (it can only settle at agreed prices;
no theft of deposited principal), but it is the central point — acknowledged, removing it is
Phase 4. Slashing (1% on Layer-B failure) + reputation are the live deterrents. NOT yet built:
full disputes, Layer-A semantic verification, Sybil/GPU attestation, prompt privacy. The Slice 1
DB does not change this — it holds no value/trust state.

---

## 11. How the user likes to work (observed)

- **Tested, committed increments** — build a slice, run the full green bar, **branch + PR per
  slice, CI green, squash-merge**, repeat. Split big slices into tested sub-increments.
- **Honest reporting** — say what passed/failed with evidence; no overclaiming. (E.g. Slither was
  reported as genuinely-not-working and deferred, not faked green.)
- **Delegates judgment** — frequently says "continue as you think best"; make the call, state it,
  and proceed. But **outward/irreversible or money-moving actions: confirm first** — publishing
  the repo, deploying, spending testnet funds, and **rewriting money-moving contracts (Slice 2)**.
  The repo `ShavitR/querais` is **private**.
- Sometimes refines substantial plans remotely in **Ultraplan** (rejects `ExitPlanMode` to hand
  off) before implementation; other times wants the plan written to `docs/`. Ask/confirm which
  for big work (it's a documented preference).
- **Dumb-proof UX matters** (one-line install, zero manual funding).
- Cost-aware — be efficient with CI cycles and tokens; batch work, don't churn.

Persistent memories for this project live at
`~/.claude/projects/C--Users-mynew-Desktop-querais/memory/` (Node-floor ≥22.13 + CWD-drift +
Ultraplan-workflow notes).

---

## 12. Loose ends / current runtime state

- **`main` is at the merge of #21** (Slice 2B). History: #1 (Slice 0) → #15 (Slice 1) → #16 →
  #18 (Slice 2A contract) → #19 (Slice 2A Sepolia deploy) → #21 (Slice 2B runtime). No open PRs.
  `git log --oneline` is the source of truth.
- **Dependabot backlog cleared.** The 12 auto-opened PRs were resolved: safe action bumps applied
  (#16), majors deferred (config now ignores npm majors), the rest auto-closed by the retune.
  Going forward Dependabot opens **one grouped minor/patch PR per month**.
- **No hosted gateway/VM node is running** — those are ephemeral and don't survive sessions.
  Restart with `pnpm gateway:sepolia` + the node scripts if needed.
- The "ultra one-liner" installer (`scripts/bootstrap.*`) still needs the **repo to be public**.
- **Next action: Slice 3 (harden the open surface).** See `docs/EXECUTION_PLAN.md` Slice 3:
  persistent IP+address faucet throttle + daily cap + distributor-balance guard, per-key quota
  tiers (429 + headers), prompt-abuse limits (max size, token caps, banned patterns), WS
  flood/conn caps, and a documented key-management + pause drill (the gateway holds every
  privileged role + a gas wallet — that blast radius needs a runbook). Effort M, Risk H.

---

## 13. Your first 5 minutes (suggested)

1. Read this file + `docs/EXECUTION_PLAN.md` (the roadmap) + skim `docs/SLICE1_PLAN.md`.
2. `Set-Location C:\Users\mynew\Desktop\querais; pnpm install; pnpm build; pnpm test` → expect green
   (ensure Node ≥22.13).
3. `pnpm test:e2e` → 6 scenarios pass (spawns its own chain; needs nothing running).
4. Skim `dispatcher.ts`, `settlement.ts`, `db/jobs.ts`, `JobEscrow.sol`, `e2e.ts` to see the spine.
5. `git log --oneline -10` for the recent arc, then confirm the **Slice 2** plan approach with the user.
