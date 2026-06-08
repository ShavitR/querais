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

## 2. Status: done / deferred

**Built & verified (Phase 1 + "Plan A" = node packaging + hosted-onboarding software):**
- Contracts: `QUAISToken`, `NodeRegistry`, `JobEscrow` (+ `ReentrantToken` test mock).
  Deployed + Arbiscan-verified on Sepolia. 30 contract tests (conservation, access control,
  reentrancy, fuzz, full node lifecycle).
- `@querais/shared`: canonical `JobSpec` + deterministic `jobId`, OpenAI schemas, gateway↔node
  wire protocol, pricing (basis-point) math, viem chain bindings. 16 tests.
- `@querais/matching`: pure scorer (0.5·price + 0.5·reputation), never touches chain. 6 tests.
- `@querais/node-daemon`: real **Ollama** inference, encrypted **keystore**, **auto-pricing**,
  **model auto-pull**, **auto-reconnect** (backoff), **auto-faucet self-funding**. 19 tests.
- `@querais/gateway`: OpenAI-compatible Fastify API, matching, on-chain settlement (95/5 +
  reputation EMA), **slashing on bad results**, rate limiting, `/metrics`, persisted-ish
  **API-key store + admin issuance**, **faucet** (drips ETH+QAIS), served **dashboard**. 17 tests.
- `@querais/sdk`: OpenAI-shaped client + `querais` CLI. 5 tests.
- `@querais/test-e2e`: a **6-scenario** acceptance gate + live/ops scripts.
- Dumb-proof node onboarding: `scripts/setup-node.*` + `start-node.*` (two commands, no Docker,
  self-funds via faucet). Docker path also exists (`scripts/install-node.*`, `docker-compose.yml`).

**Deferred (do NOT assume these exist):**
- **Phase 3** (public launch): hosted/HA deploy, persistence/DB, batched settlement, full
  SRE/monitoring, Sybil hardening, Redis-scaled matching, Layer-A verification, DX portal,
  tokenomics activation, CI/CD. → fully planned in **`docs/PHASE3_PLAN.md`**.
- **Phase 4/5**: libp2p/on-chain-auction/decentralized-oracle (remove the trusted gateway),
  full `DisputeResolution` arbitration, TEE prompt privacy, mainnet/TGE, DAO.
- **Not in CI yet**: Slither + coverage (planned in Phase 3 P3.5).

---

## 3. Repo layout (pnpm monorepo, TypeScript ESM)

```
packages/
  contracts/    Solidity + Hardhat 3. contracts/*.sol, scripts/{deploy,export-abis,preflight}.ts
                deployments/addresses.<network>.json (sepolia committed, localhost gitignored)
                src/ → built dist/ exports ABIs (as-const) + loadAddresses()
  shared/       @querais/shared — types/schemas/jobId/pricing/wire/chain (the cross-layer contract)
  matching/     @querais/matching — pure provider selection (no viem at runtime)
  gateway/      @querais/gateway — src/{server,dispatcher,node-pool,settlement,verify,chain-client,
                key-store,faucet,metrics,config,auth}.ts + routes/*
  node-daemon/  @querais/node-daemon — src/{daemon,gateway-client,registry,keystore,pricing,
                auto-fund,report,config}.ts + inference/{backend,ollama,mock}.ts
  sdk/          @querais/sdk — client.ts + cli.ts
  test-e2e/     harness.ts + e2e.ts + run-e2e.ts (+ demo, live-sepolia, gateway-sepolia, prepare-vm-node)
apps/dashboard/ placeholder (the live dashboard is served by the gateway at `/`)
docs/PHASE3_PLAN.md   the next phase
querais_*.md          the 7 original design/whitepaper docs (vision, architecture, contracts,
                      tokenomics, reputation, node design, go-to-market) — read for intent
```

**The most load-bearing files:** `packages/contracts/contracts/JobEscrow.sol` (escrow + 95/5
settlement), `packages/shared/src/jobspec.ts` (canonical spec + jobId), `packages/gateway/src/
dispatcher.ts` (match → lock/assign → stream → verify → settle), `packages/node-daemon/src/
inference/ollama.ts`, `packages/test-e2e/src/e2e.ts` (the acceptance scenarios).

---

## 4. Job lifecycle (how a request flows)

1. `POST /v1/chat/completions` (Bearer API key → requester wallet via `ApiKeyStore`).
2. Gateway normalizes → canonical `JobSpec` (`jobId = keccak256(canonical bytes)`).
3. `matching.selectBest()` picks a node from the in-memory pool (price + reputation).
4. Gateway (MATCHING_ENGINE) `createJob` (locks QAIS) → `assignJob` on-chain.
5. Node runs **real inference** (Ollama), streams tokens over WS; gateway proxies + **counts
   tokens independently** (settles on `min(node, gateway)` — trust-minimized).
6. **Layer-B verify** (`verify.ts`): non-empty, length, no loops, and `resultHash ==
   hash(forwarded text)`. (Deliberately **no cross-node hash matching** — see §6.)
7. Settle: `completeJob` → `verifyAndRelease` (95% provider / 5% treasury / refund) + reputation
   EMA; on failure → `failJob` refund + slash. (`Settlement` interface; `ChainSettlement` impl.)

---

## 5. Run & verify (commands)

From the repo root (PowerShell). **Always `Set-Location C:\Users\mynew\Desktop\querais` first
if a previous Hardhat command ran — see §7.**

```
pnpm install              # esbuild build is allow-listed in pnpm-workspace.yaml
pnpm build               # builds all packages (contracts = hardhat compile + export-abis + tsc)
pnpm typecheck
pnpm lint                # eslint + prettier --check  (run `pnpm exec prettier --write .` first!)
pnpm test                # all unit tests (~70+)
pnpm test:e2e            # self-contained: spawns fresh local chain, deploys, runs 6 scenarios
pnpm demo                # local human demo (real Ollama + dashboard)
```
Local chain manually: `pnpm chain` (terminal 1) + `pnpm deploy:local` (terminal 2).
Sepolia: `pnpm preflight:sepolia` (checks deployer funded) → `pnpm deploy:sepolia` → verify cmds it prints.
Run hosted on Sepolia: `pnpm gateway:sepolia` (host, binds 0.0.0.0:8787) + a node via
`scripts/setup-node.*` then `scripts/start-node.*`. `pnpm prepare:vm-node` auto-funds a node key.

**Green bar = build + typecheck + lint + test + test:e2e all pass.** That's the bar before any commit.

---

## 6. Design rules that MUST hold (don't "fix" these)

- **No cross-node output hashing for verification.** `temperature=0` is NOT deterministic
  across GPUs/backends/CUDA — hash-matching honest nodes would falsely slash them. Verification
  is **Layer-B (objective checks) + economic staking**, with Layer-A (semantic similarity) as a
  future sampling oracle. `resultHash` only pins a node to *what it sent the gateway*.
- **Token count = `min(node-reported, gateway-counted)`** (the gateway counts streamed tokens
  itself; never trust the node alone).
- **Job deadlines derive from CHAIN time** (`block.timestamp`), not wall-clock — Hardhat drifts
  the block clock under bursty load and `createJob` checks `deadline > block.timestamp`. (This
  was a real bug; don't revert it.)
- **All fee/price math is integer wei + basis points** (no floats on-chain). Float USD→wei
  conversion happens once, off-chain, in `shared/src/pricing.ts`.
- **Contracts**: CEI on every fund-moving fn, OZ `ReentrancyGuard`/`SafeERC20`/`AccessControl`/
  `Pausable`, custom errors, strict job state machine. `JobEscrow` is the job registry (no
  separate registry contract).
- **`matching` stays pure** (no viem/chain at runtime) so it can move on-chain in Phase 4.
- Keep changes **additive via the existing seams**: `Settlement`, `InferenceBackend`,
  `ApiKeyStore`, `FaucetDistributor`, `loadAddresses(network)`, the gateway↔node WS transport.

---

## 7. Environment traps (these already cost time)

- **Windows + PowerShell** is the shell. The **Bash tool is git-bash** (use it for `bash -n`);
  PowerShell's `bash` is WSL and has **no distro** (fails).
- **CWD drift:** running Hardhat via pnpm (`pnpm --filter @querais/contracts ...`) leaves the
  PowerShell CWD in `packages/contracts`. Before any root-level `pnpm lint/test/build` or
  relative path, run `Set-Location C:\Users\mynew\Desktop\querais`. (Symptom: prettier flags
  `dist/`/`cache/`/`abis.ts` because it didn't find the root `.prettierignore`.)
- **Format before committing:** run `pnpm exec prettier --write .` then `pnpm lint`. Several
  commits failed lint because code was committed before formatting.
- **PowerShell here-strings mangle `git commit -m`** — use multiple `-m` flags instead. End
  every commit message with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`.env` via Notepad becomes `.env.txt` + adds a BOM** → vars silently not loaded (defaults
  to `NETWORK=localhost`, missing keys). Create `.env` with a PowerShell here-string
  `... | Out-File .env -Encoding ascii`, or set vars inline with `$env:`.
- **tsx isn't a bare command** — invoke via pnpm scripts or `pnpm --filter <pkg> exec tsx`.
- **Hardhat 3 specifics:** `defineConfig`, `network.connect()` honors `--network`, contract
  types come from generated `artifacts/**/artifacts.d.ts` (the contracts typecheck tsconfig
  includes them and disables `noUncheckedIndexedAccess`/`declaration`). No built-in `coverage`.
- **Ollama** is the inference backend (running locally; `gemma3:4b` + `qwen3:1.7b` pulled).
  qwen3 is a thinking model — the daemon sends `think:false`.

---

## 8. On-chain deployment (Arbitrum Sepolia, chainId 421614)

Manifest: `packages/contracts/deployments/addresses.arbitrumSepolia.json` (committed).
- QUAISToken `0x1e89e050e68e81c32980205ec0db444ede3f4e2c`
- NodeRegistry `0x6d13d0f94ef912c6817a74c632a378997eacf776`
- JobEscrow `0x60c87b02db5aabd27ff5f72a447b9fba4fbbd6b0`
- Deployer = admin = gateway = treasury = requester = `0xc80A8137E57D494b195EdA12f74d7Df324f5b9d6`
  (a single throwaway testnet wallet holding the 1B QAIS + all roles, for the hybrid setup).

Secrets live in `.env` (gitignored): `DEPLOYER_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_RPC_URL`,
`ETHERSCAN_API_KEY`, gateway/node/requester keys, `NODE_SEPOLIA_PRIVATE_KEY`. See `.env.example`
for every variable. **Never commit `.env`; never put real-value keys in it (testnet only).**

---

## 9. Trust model (important when changing security)

The gateway is **trusted**: it holds ORACLE+MATCHING+SLASHER roles, a gas wallet, and the
faucet distributor. Worst case if compromised is bounded (it can only settle at agreed prices;
no theft of deposited principal), but it is the central point — acknowledged, and removing it
is Phase 4. Slashing (1% on Layer-B failure) + reputation are the live deterrents. NOT yet
built: full disputes, Layer-A semantic verification, Sybil/GPU attestation, prompt privacy.

---

## 10. How the user likes to work (observed)

- **Tested, committed increments** — build a slice, run the full green bar, commit + push, repeat.
- **Honest reporting** — say what passed/failed with evidence; no overclaiming.
- **Dumb-proof UX matters** to them (one-line install, zero manual funding).
- They sometimes refine plans remotely in **Ultraplan** (they reject `ExitPlanMode` to hand
  off); other times they want the plan written directly. Ask/confirm which.
- Outward-facing/irreversible actions (publishing the repo, deploying, spending testnet funds):
  **confirm first.** The repo `ShavitR/querais` is currently **private**.

Persistent memories for this project live at
`~/.claude/projects/C--Users-mynew-Desktop-querais/memory/` (CWD-drift + Ultraplan-workflow notes).

---

## 11. Loose ends / current runtime state

- Reputation cache display bug — **fixed** (`/v1/nodes` refreshes from chain after settlement).
- During the last session a **Sepolia host gateway** was left running in a background shell
  (`pnpm gateway:sepolia`, 0.0.0.0:8787) with a VM node connected — these are **ephemeral** and
  will not survive a new session; restart with `pnpm gateway:sepolia` + the node scripts if needed.
- The "ultra one-liner" installer (`scripts/bootstrap.*`) needs the **repo to be public**.
- `git log --oneline` is the source of truth for history; `main` is the working branch and is
  pushed to `github.com/ShavitR/querais`.

---

## 12. Your first 5 minutes (suggested)

1. Read this file + skim `docs/PHASE3_PLAN.md` and `querais_overview.md`.
2. `Set-Location C:\Users\mynew\Desktop\querais; pnpm install; pnpm build; pnpm test` → expect green.
3. `pnpm test:e2e` → 6 scenarios pass (spawns its own chain; needs nothing running).
4. Skim `dispatcher.ts`, `JobEscrow.sol`, `jobspec.ts`, `e2e.ts` to see the spine.
5. Check `git log --oneline -15` for the recent arc, then ask the user what milestone to pick up.
