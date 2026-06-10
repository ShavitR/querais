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
**gateway** does matching + holds the ORACLE/MATCHING/SLASHER/SETTLER keys + pays settlement
gas; nodes and requesters all talk to it. It is **NOT** a P2P mesh yet (future Phase 4).
Everything is on **Arbitrum Sepolia testnet — no real value.**

It is real and working: contracts are **deployed + verified on Arbitrum Sepolia**, a job has
run **end-to-end across two machines** (a separate VM served a real `gemma3:4b` completion
that settled on-chain), and **batched settlement is live**: a requester deposits once, signs
ONE EIP-712 spending cap, fires 100 API calls with zero per-call wallet txs, and they settle
in a single `batchSettle` transaction (proven in e2e).

---

## 2. The plan we're executing (READ THIS)

The live roadmap is **`docs/EXECUTION_PLAN.md`** — protocol-first sequencing (companion to
the catalogue in `docs/PHASE3_PLAN.md`; where they disagree on order, EXECUTION_PLAN wins).
Thesis: **make the protocol complete/credible first, then operate it as a hosted service.**

```
Stage A — Foundation        ✅ 0 CI gate  ✅ 1 Persistence  ✅ 2 Batched settlement ⭐ (2A+2B+2C)
                            ◐ 3 Harden surface (3A merged #25; 3B-1 ops in PR; 3B-2 Slither next)
Stage B — Protocol depth    ⬜ 4 Reputation   ⬜ 5 Layer-A verify   ⬜ 6 Tokenomics
Stage C — Operate           ⬜ 7 Deploy   ⬜ 8 Observability   ⬜ 9 DX/node-polish/growth
```

**Working rhythm (established, stick to it):** one **branch + PR per slice** (big slices
split into tested sub-increments, e.g. 2A/2B/2C, 3A/3B), gated by the **green bar in CI**,
squash-merged to `main`. Pause for review at slice boundaries. **The user must approve
merges to main** (a permission classifier blocks self-merging; ask, or the user clicks).

**Immediate next actions (in order):**
1. **Merge the `slice-3b-ops` PR** (Slice 3B-1 — pause tooling/tests/drill, key runbook,
   Sepolia admin/pauser key split, `GET /v1/sessions`; needs the user's go-ahead).
2. **Slice 3B-2 — Slither revisit** on branch `slice-3b-slither`: timeboxed, non-gating CI
   job (decision ladder: latest slither on HH3 artifacts → Foundry analysis profile →
   `cp -rL` flatten → documented deferral). Any real-looking finding in money paths →
   surface to the user before merging.
3. Then **Stage B**. Slice 6 (`ProtocolTreasury.sol`, 60/20/20 split) is money-moving
   contract work → **confirm the design with the user before building** (standing rule).

A session-approved roadmap restatement lives at
`~/.claude/plans/melodic-scribbling-deer.md` (Slice 2C gap analysis + the staged plan).
EXECUTION_PLAN.md remains the canonical roadmap.

---

## 3. Status: done / in-progress / deferred

**Merged to `main` (PR trail: #1 → #15 → #16 → #18 → #19 → #21 → #22 → #23 → #24 → #25):**
- **Slice 0** — CI green-bar gate (blocking build/typecheck/lint/test/test:e2e), solhint
  (blocking), coverage + audit (non-gating), Dependabot monthly/grouped/no-npm-majors.
  *Slither deferred*: solc `--allow-paths` breaks under pnpm's symlinked store and Slither
  doesn't auto-detect Hardhat 3. *Contract-line coverage deferred* (no HH3 tool).
- **Slice 1** — durable gateway state via **`node:sqlite`** (zero new deps): API keys,
  faucet claims (atomic INSERT throttle), job records, derived `/v1/usage`. DB is a thin
  cache/index, never the source of truth (see §6). Detail: `docs/SLICE1_PLAN.md`.
- **Slice 2A** (#18, #19) — **`CreditAccount.sol`**: deposit → EIP-712 signed spending cap
  → `batchSettle(cap, sig, debits[])` with per-job idempotency (`settledJob`), cumulative
  cap enforcement (`spentAgainst`), 95/5 split, withdraw-after-1-day-notice. Deployed +
  verified on Sepolia (additively — token/registry/escrow unchanged).
- **Slice 2B** (#21) — gateway side: durable `SessionStore` + `DebitLedgerStore` (migration
  3), `BatchedSettlement implements Settlement` (flush at threshold / shutdown), dispatcher
  venue choice (active session → batched, else per-job escrow), `POST /v1/sessions` +
  `GET /v1/credit/info`, SDK `openSession()`.
- **Slice 2C** (#24) — **settlement-correctness hardening** (money-path gaps found in a
  line-by-line review of 2B; all gateway-side, no contract changes):
  - `receipt.status` checked on EVERY chain write (`waitForSuccess` in `chain-client.ts`) —
    viem does NOT throw on a mined-but-reverted tx.
  - **Reconcile-on-revert**: if a flush reverts, query `settledJob(jobId)` per pending debit
    and stamp already-settled ones with a `recovered:*` sentinel — a crash between tx-send
    and `markBatched` can no longer wedge a requester's ledger forever. `markBatched` is
    transactional.
  - **`canAccrue()` headroom**: on-chain spent + off-chain pending + worst-case job cost
    must fit the signed cap AND the deposit before routing batched; otherwise **fall back
    to per-job escrow** (providers never serve work the flush could never settle).
  - **Session-deadline margin** (`sessionDeadlineMarginSeconds`, default 240s): near cap
    expiry, route to escrow and flush pending debits early (`CapExpired` is unsettleable).
  - Flush failures **non-fatal** to the triggering request (debit durable; retried on
    threshold/timer/shutdown). **Interval flush** (`GATEWAY_BATCH_FLUSH_INTERVAL_SECONDS`,
    default 60s) so low-traffic requesters never wait unboundedly.
  - E2E batched scenario at the literal acceptance bar: **100 calls → 1 tx, 0 requester txs**.
- **README rewrite** (#23) — accurate, detailed, dumb-proof (done by a parallel session).

**Slice 3A (merged #25) — harden the open surface.**
All gateway-side, additive via a new optional **`hardening`** config group
(`HARDENING_DEFAULTS` in `gateway/src/config.ts`; every knob env-overridable):
- **Faucet anti-drain** (durable/restart-proof; migration 4 adds `ip` to faucet_claims):
  per-IP daily throttle (default 3), global daily cap (default 100), distributor **balance
  guard** (optional `qaisBalance`/`ethBalance` on `FaucetDistributor` — refuses cleanly
  when dry without burning the address's one claim).
- **Per-key quota tiers** (`api_keys.tier`, default `free`; free/pro/unlimited via
  `GATEWAY_QUOTA_TIERS` JSON): daily job + token budgets **derived from persisted job rows**
  over a rolling 24h window (no counter table); 429 `quota_exceeded` + `x-querais-quota-*`
  headers; **failed attempts burn job quota**; `POST /v1/keys` accepts optional `tier`.
  New module: `gateway/src/quota.ts` (`QuotaEnforcer`, `validatePromptLimits`).
- **Prompt-abuse limits**: max messages (50) / prompt chars (32k) / `max_tokens` cap (4096)
  / optional banned patterns — 400 **before any matching or chain interaction**.
- **/node WS flood protection** (`NodePool`, optional opts): connection cap (256), per-IP
  cap (4), handshake timeout (10s), per-socket message-rate cap. **Rate default is
  deliberately 5000/s** — every streamed token is one WS message; a 500/s default killed
  the node mid-e2e. (Silver lining: the 2C recovery machinery handled it unprompted —
  reconnect + interval flush settled the stranded debits. Working as designed.)
- New e2e **hardening scenario**: prompt 400, quota 429 with headers, faucet per-IP 429 on
  fresh addresses.

**Built, awaiting user merge: PR `slice-3b-ops` — Slice 3B-1 (ops hardening).**
No contract changes, no new migrations. See `docs/RUNBOOK_KEYS.md` (the operational core):
- **`scripts/pause.ts`** (contracts pkg; `pnpm ops:pause` from root) — tsx+viem incident
  CLI, **no Hardhat runtime** (works when the toolchain is broken): `status|pause|unpause
  --network <localhost|arbitrumSepolia>`, idempotent, receipt-checked, signs with
  `PAUSER_PRIVATE_KEY`. Deliberately **NOT an HTTP endpoint** (must work when the gateway
  is compromised/down — runbook §8).
- **`test/Pausable.ts`** (7 tests) pins the pause table: pause freezes value inflows +
  settlement; **every exit/refund path stays open while paused** (completeUnbonding,
  failJob/cancelJob/timeoutJob, initiateWithdrawal/completeWithdrawal). Update the runbook
  §5 table and these tests together.
- **E2E pause drill** (9th scenario) spawns the REAL pause script against the e2e chain:
  pause → chat 5xx while `/health` stays up → unpause → service restored.
- **`GET /v1/sessions`** — requester session visibility (session + cap spend/remaining +
  credit balance + pending debits + headroom; wei as decimal strings). Pure derivation in
  `gateway/src/session-status.ts` (`buildSessionStatus`, mirrors `canAccrue` math exactly);
  SDK `sessionStatus()`. Batched e2e scenario now asserts status at open/mid-run/post-flush.
- **`scripts/split-admin.ts`** + **executed Sepolia key split**: cold admin EOA
  `0x85cC...9dE8` now holds DEFAULT_ADMIN + PAUSER on all three contracts; the hot gateway
  key holds **neither** (only operational roles). Live pause/unpause drill done
  (time-to-pause 10.5s) — runbook §6 drill log entry #2.

**Deferred (do NOT assume these exist):**
- **Slice 3B-2** (Slither CI revisit) and Slices 4–9.
- `DisputeResolution.sol`, `ProtocolTreasury.sol` — 0% built (specs in
  `querais_smart_contracts.md` §5–6). Fees currently go to a flat treasury EOA.
- Phase 4/5: libp2p, on-chain auction, decentralized oracle, TEE privacy, mainnet/TGE, DAO.
- Dependency majors (zod 4, openai 6, ts 6, …) — deliberate; Dependabot ignores npm majors.

---

## 4. Repo layout (pnpm monorepo, TypeScript ESM)

```
packages/
  contracts/    Solidity 0.8.28 + Hardhat 3. QUAISToken, NodeRegistry, JobEscrow,
                CreditAccount (+ reentrancy test mocks). deployments/addresses.<network>.json.
                scripts/{pause,split-admin}.ts ops CLIs (tsx+viem, no HH runtime).
                55 tests (conservation, guards, reentrancy, EIP-712 parity, pausability, gas).
  shared/       @querais/shared — JobSpec/jobId, OpenAI schemas, wire protocol, pricing
                (basis-point), EIP-712 spending-cap sign/recover, chain bindings. 21 tests.
  matching/     @querais/matching — pure scorer (0.5·price + 0.5·reputation), no chain IO. 6 tests.
  gateway/      @querais/gateway — Fastify OpenAI API. src/{server,dispatcher,node-pool,
                settlement,batched-settlement,verify,chain-client,quota,session-status,
                key-store,faucet,metrics,config,auth,http}.ts + routes/* + db/{index,
                migrations,jobs,sessions,ledger}.ts. 56 tests.
  node-daemon/  @querais/node-daemon — Ollama inference, encrypted keystore, auto-pricing,
                auto-faucet, auto-reconnect. 19 tests.
  sdk/          @querais/sdk — OpenAI-shaped client (+ `openSession`, `sessionStatus`)
                + `querais` CLI. 6 tests.
  test-e2e/     harness + 9-scenario acceptance gate + live/ops scripts.
apps/dashboard/ placeholder (the live dashboard is served by the gateway at `/`)
docs/EXECUTION_PLAN.md   the live roadmap (what we're following)
docs/RUNBOOK_KEYS.md     key custody + emergency pause runbook (2am copy-pasteable)
docs/SLICE1_PLAN.md      thin-DB principle + node:sqlite rationale
docs/PHASE3_PLAN.md      broader workstream catalogue
querais_*.md             the 7 original design/whitepaper docs — read for intent
```

**Most load-bearing files:** `contracts/CreditAccount.sol` + `JobEscrow.sol`,
`shared/src/spending-cap.ts` (EIP-712 — must mirror the contract), `gateway/src/dispatcher.ts`
(match → venue choice → stream → verify → settle), `gateway/src/batched-settlement.ts`
(ledger/flush/reconcile/canAccrue), `gateway/src/quota.ts`, `gateway/src/db/migrations.ts`
(**4 migrations** — append-only, never edit released ones), `test-e2e/src/e2e.ts`.

---

## 5. Job lifecycle (how a request flows)

1. `POST /v1/chat/completions` (Bearer key → wallet via `ApiKeyStore`). **Quota check**
   (429 + headers) and **prompt limits** (400) run first — before matching or the chain.
2. Normalize → canonical `JobSpec` (`jobId = keccak256(canonical bytes)`).
3. `matching.selectBest()` picks a node (price + reputation).
4. **Venue choice**: active credit session AND deadline outside the margin AND
   `canAccrue(worst case)` → **batched** (no per-job chain writes; deposit + signed cap are
   the collateral). Otherwise → per-job escrow (`createJob` + `assignJob`).
5. Node streams tokens over WS; gateway proxies + counts independently
   (settles on `min(node, gateway)`).
6. **Layer-B verify** (non-empty, length, loop detection, `resultHash == hash(forwarded)`).
7. Settle: batched → durable debit, flushed at threshold/interval/deadline-margin/shutdown
   in ONE `batchSettle`; escrow → `completeJob` → `verifyAndRelease` (95/5). Reputation EMA
   on success; refund + slash on failure.

---

## 6. Design rules that MUST hold (don't "fix" these)

- **No cross-node output hashing for verification.** `temperature=0` is NOT deterministic
  across GPUs/backends. Verification is Layer-B + economic staking; Layer-A (semantic
  similarity sampling) is Slice 5. `resultHash` only pins a node to what it sent.
- **Token count = `min(node-reported, gateway-counted)`** — never trust the node alone.
- **Job deadlines derive from CHAIN time** (`block.timestamp`), not wall-clock.
- **All fee/price math is integer wei + basis points** (no floats on-chain).
- **Check `receipt.status` on every chain write** — viem does NOT throw on a
  mined-but-reverted tx (use/extend `ChainClient.waitForSuccess`). (2C.)
- **A flush failure must never fail the triggering request** — debits are durable and
  retried; reconcile-on-revert keeps the ledger unstickable. (2C.)
- **Never accept batched work the flush couldn't settle** — `canAccrue` headroom + the
  deadline margin guard this; per-job escrow is the always-available fallback. (2C.)
- **Usage/quota are DERIVED from job rows** — no counter tables to keep in sync. (3A.)
- **WS message-rate caps must stay generous** — every streamed token is one WS message; a
  fast node legitimately sustains ~1k msg/s. The cap blocks raw floods only. (3A.)
- **Contracts**: CEI on every fund-moving fn, OZ ReentrancyGuard/SafeERC20/AccessControl/
  Pausable, custom errors, strict state machines.
- **Pause freezes value inflows + settlement; every user exit/refund path stays open while
  paused** (a pause can never trap funds). Pinned by `contracts/test/Pausable.ts` and the
  `RUNBOOK_KEYS.md` §5 table — change them together. QUAISToken is NOT pausable. (3B-1.)
- **`matching` stays pure** (no chain IO) so it can move on-chain in Phase 4.
- **The gateway DB is a thin cache/index, never the source of truth for value/trust.**
- Keep changes **additive via the existing seams**: `Settlement`, `InferenceBackend`,
  `ApiKeyStore`, `FaucetDistributor`, `GatewayDb`/stores, `NodePoolOptions`,
  `HardeningConfig`, `loadAddresses(network)`, the WS transport.

---

## 7. Run & verify (commands)

From the repo root (PowerShell). **Always `Set-Location C:\Users\mynew\Desktop\querais`
first if a previous Hardhat command ran — see §8.**

```
pnpm install
pnpm build               # REBUILD BEFORE test:e2e after editing gateway src — e2e consumes dist/!
pnpm typecheck
pnpm lint                # eslint + prettier --check  (run `pnpm exec prettier --write .` first!)
pnpm test                # all unit tests (102 TS + the contract suite)
pnpm test:e2e            # self-contained: fresh local chain → 9 scenarios (~25s)
pnpm demo                # local human demo (real Ollama + dashboard)
```
Sepolia: `pnpm preflight:sepolia` → `pnpm deploy:sepolia` (full) or
`pnpm deploy:credit:sepolia` (additive). Hosted test: `pnpm gateway:sepolia` + node scripts;
`pnpm prepare:vm-node` auto-funds a node key.

**Green bar = build + typecheck + lint + test + test:e2e.** CI runs the same on every PR
(+ solhint); a PR must be green to merge.

---

## 8. Environment traps (these already cost time)

- **Node ≥ 22.13 REQUIRED** (`node:sqlite`). Local dev Node 26; CI Node 22.
- **Windows + PowerShell.** The Bash tool is git-bash — backslash paths silently fail; use
  `/c/Users/...`. PowerShell's `bash` is WSL with no distro.
- **CWD drift:** Hardhat-via-pnpm leaves PowerShell CWD in `packages/contracts`. Reset to
  the repo root before any root-level pnpm command.
- **`pnpm test:e2e` runs against BUILT packages (`dist/`)** — editing gateway source and
  re-running e2e without `pnpm build` tests stale code (cost a debugging loop in 3A).
- **Format before committing:** `pnpm exec prettier --write .` then `pnpm lint` (it checks
  YAML/JSON/MD too).
- **PowerShell here-strings mangle `git commit -m` and `gh pr create --body`** — use
  multiple `-m` flags / `--body-file <file>`. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`.env` via Notepad becomes `.env.txt` + a BOM** — write with `Out-File -Encoding ascii`.
- **Hardhat 3:** `defineConfig`, `network.connect()`, solc 0.8.28/cancun. No coverage tool;
  Slither framework auto-detect unsupported (revisit in 3B).
- **Ollama** backend (`gemma3:4b`, `qwen3:1.7b` with `think:false`). Tests/e2e use MockBackend.
- **Parallel sessions exist** (Ultraplan/remote agents merged PRs #21/#23 while another
  session was open, and the local checkout switched branches underneath it). Before
  branching or assuming state: `git fetch; git log origin/main --oneline -5; gh pr list`
  and verify `git branch --show-current` before committing.

---

## 9. On-chain deployment (Arbitrum Sepolia, chainId 421614)

Manifest: `packages/contracts/deployments/addresses.arbitrumSepolia.json` (committed).
- QUAISToken `0x1e89e050e68e81c32980205ec0db444ede3f4e2c`
- NodeRegistry `0x6d13d0f94ef912c6817a74c632a378997eacf776`
- JobEscrow `0x60c87b02db5aabd27ff5f72a447b9fba4fbbd6b0`
- CreditAccount `0x1e44f2ce56d90f764121b82bc3571b08a1d15522`
- Hot gateway EOA `0xc80A8137E57D494b195EdA12f74d7Df324f5b9d6` = deployer = gateway =
  treasury, holding only the **operational** roles (ORACLE/MATCHING/SLASHER/SETTLER).
- **Cold admin EOA `0x85cC469CBB1197480Dc399F5B2AC731102119dE8`** holds DEFAULT_ADMIN +
  PAUSER on all three pausable contracts (key split executed 2026-06-10 via
  `scripts/split-admin.ts`; see `docs/RUNBOOK_KEYS.md` §7). Its key is `ADMIN_PRIVATE_KEY`
  / `PAUSER_PRIVATE_KEY` in the repo-root `.env` (gitignored) + an operator offline copy.
  **A gateway-key leak no longer surrenders pause/rotation authority.**

Secrets in `.env` (gitignored); see `.env.example`. Key envs: `DEPLOYER_PRIVATE_KEY` /
`GATEWAY_PRIVATE_KEY` (hot), `ADMIN_PRIVATE_KEY` + `PAUSER_PRIVATE_KEY` (cold, 3B-1).
Gateway env knobs added in 2C/3A (all
optional — defaults in `HARDENING_DEFAULTS`, `gateway/src/config.ts`):
`GATEWAY_BATCH_FLUSH_INTERVAL_SECONDS`, `GATEWAY_SESSION_DEADLINE_MARGIN_SECONDS`,
`GATEWAY_FAUCET_IP_DAILY_LIMIT`, `GATEWAY_FAUCET_DAILY_CAP`, `GATEWAY_QUOTA_TIERS` (JSON),
`GATEWAY_MAX_MESSAGES`, `GATEWAY_MAX_PROMPT_CHARS`, `GATEWAY_MAX_TOKENS_CAP`,
`GATEWAY_BANNED_PATTERNS` (regex CSV), `GATEWAY_WS_MAX_CONNECTIONS`,
`GATEWAY_WS_MAX_PER_IP`, `GATEWAY_WS_HANDSHAKE_TIMEOUT_MS`,
`GATEWAY_WS_MAX_MESSAGES_PER_SECOND`.

---

## 10. Trust model (important when changing security)

The gateway is **trusted**: ORACLE+MATCHING+SLASHER+SETTLER roles, a gas wallet, the faucet
distributor. Worst case if compromised is bounded — it can only settle at signed/agreed
prices (the CreditAccount cap + signature are enforced on-chain); no theft of deposited
principal. Removing it is Phase 4. Live deterrents: slashing (1% on Layer-B failure),
reputation EMA, staking. Slice 3A added the adversarial-surface layers (quotas, throttles,
flood caps); Slice 3B-1 added the operational layers — **`docs/RUNBOOK_KEYS.md`** is the
canonical blast-radius + incident-response doc (key inventory, pause drill log, rotation,
the executed admin/pauser key split). NOT yet built: full disputes, Layer-A verification,
GPU attestation, prompt privacy.

---

## 11. How the user likes to work (observed)

- **Tested, committed increments** — slice → green bar → branch+PR → CI green → squash-merge.
- **The user approves merges to main** — a permission classifier blocks self-merging;
  surface "CI is green, ready to merge" and wait for the go-ahead (a short "yes" from them
  authorizes the merge — then `gh pr merge --squash --delete-branch` works).
- **Honest reporting** — say what passed/failed with evidence; report your own mistakes
  (e.g. 3A's 500 msg/s default broke e2e — it was reported and explained, not buried).
- **Delegates judgment** — "continue as you think best"; make the call, state it, proceed.
  But **outward/irreversible/money-moving: confirm first** — publishing, deploying, spending
  funds, and money-moving contract work (the Slice 6 Treasury explicitly so).
- Sometimes refines big plans in **Ultraplan**; sometimes wants plan mode or `docs/` plans.
  The latest session: deep-dive subagents → plan mode → approval → build. Ask for big work.
- **Dumb-proof UX matters.** Cost-aware — batch work, don't churn CI.

Persistent memories: `~/.claude/projects/C--Users-mynew-Desktop-querais/memory/`.

---

## 12. Loose ends / current runtime state

- **The `slice-3b-ops` PR (Slice 3B-1) is OPEN — merging needs the user's go-ahead.**
  `main` is at #25 (Slice 3A).
  **Verify with `gh pr list` + `git log origin/main --oneline -3` before acting** — a
  parallel session may have merged it already.
- After 3B-1 merges: **Slice 3B-2** (Slither, scope in §2), then Stage B.
- The **Sepolia key split is already executed on-chain** (it's an on-chain fact, not tied
  to any PR): pause/rotation need the cold `ADMIN_PRIVATE_KEY` from the repo-root `.env`.
  Dependabot PR #20 is open with CI red (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`) — the
  supply-chain age policy working as designed; leave it until the package ages in.
- **No hosted gateway/VM node is running** — restart with `pnpm gateway:sepolia` + the node
  scripts if needed (the VM at 172.22.52.24 has a restart recipe in project memory).
- The "ultra one-liner" installer still needs the repo (ShavitR/querais, private) to go
  public — a user decision, likely Slice 9.
- Counts that tests assert or reports cite: e2e = **9 scenarios**, gateway unit = **56**,
  contracts = **55**, TS unit total = **109**, migrations = **4** (`MIGRATION_COUNT`
  tracks automatically).

---

## 13. Your first 5 minutes (suggested)

1. Read this file + `docs/EXECUTION_PLAN.md`.
2. `git fetch; git log origin/main --oneline -5; gh pr list` — confirm open-PR state.
3. `Set-Location C:\Users\mynew\Desktop\querais; pnpm install; pnpm build; pnpm test` → green.
4. `pnpm test:e2e` → 9 scenarios pass (self-contained, ~25s).
5. Skim `dispatcher.ts`, `batched-settlement.ts`, `quota.ts`, `CreditAccount.sol`, `e2e.ts`,
   and `docs/RUNBOOK_KEYS.md`.
6. Confirm the Slice 3B scope with the user, then follow the rhythm in §2.
