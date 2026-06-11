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
                            ✅ 3 Harden surface (3A #25 · 3B-1 ops #26 · 3B-2 Slither #27)
Stage B — Protocol depth    ✅ 4 Reputation (4A #28 · 4B #29)   ✅ 5 Layer-A (5A #30 · 5B #31)   ✅ 6 Tokenomics (6A #33 · 6B #34 · 6C #35)
Stage C — Operate           ◐ 7 Deploy (7A #37 code · 7B operator)   ⬜ 8 Observability   ⬜ 9 DX/growth
```

**Working rhythm (established, stick to it):** one **branch + PR per slice** (big slices
split into tested sub-increments, e.g. 2A/2B/2C, 3A/3B), gated by the **green bar in CI**,
squash-merged to `main`. Pause for review at slice boundaries. **The user must approve
merges to main** (a permission classifier blocks self-merging; ask, or the user clicks).

**STAGES A AND B COMPLETE; Slice 7A (deploy-ready hardening, code-side) COMPLETE.**
Immediate next actions:
1. **Slice 7B — the live hosting (OPERATOR action, needs keys + a platform).** A remote
   agent cannot do this; it is fully scripted in runbook **§7d** (deploy, single
   instance, volume + Litestream backup, restore drill, secrets) and **§7b** (the
   full-protocol Sepolia redeploy). Hand to the maintainer.
2. **Slice 8 — observability & SRE.** Highest-value item: close the manual-review loop —
   `node_flags` + rapid-decline + Layer-A anomalies are computed but **nobody is paged**;
   wire a notification channel + a minimal review queue. Then Prometheus/Grafana, alert
   rules (oldest-unflushed-debit age, gas/bond gauges), status page. Mostly code-side —
   plan before building (§11).
3. Then Slice 9 (DX/node-polish/growth) → Stage D (web app, arbitration, scale, mainnet).

`docs/EXECUTION_PLAN.md` is the canonical roadmap — everything needed to continue is in
this repo (no local-machine files are required; see §12 for what remote agents can't do).

---

## 3. Status: done / in-progress / deferred

**Merged to `main` (PR trail: #1 → #15 → #16 → #18 → #19 → #21 → #22 → #23 → #24 → #25 → #26 → #27 → #28 → #29 → #30 → #31 → #32 → #33 → #34 → #35 → #37):**
- **Slice 0** — CI green-bar gate (blocking build/typecheck/lint/test/test:e2e), solhint
  (blocking), coverage + audit (non-gating), Dependabot monthly/grouped/no-npm-majors.
  *Slither was deferred here* (solc `--allow-paths` breaks under pnpm's symlinked store;
  Slither can't drive Hardhat 3) — **resolved in 3B-2** via a symlink-free scratch copy.
  *Contract-line coverage deferred* (no HH3 tool).
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

**Slice 3B-1 (merged #26) — ops hardening.**
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

**Slice 3B-2 (merged #27) — Slither CI.**
The Slice 0 Slither deferral, closed. Non-gating `slither` CI job: slither-analyzer 0.11.5
+ solc 0.8.28 on a **symlink-free scratch copy** of the contracts (crytic-compile can't
parse HH3 build-info; `--allow-paths` rejects pnpm's store — both documented). Triage in
`packages/contracts/slither.config.json`; full per-detector rationale in
**`docs/SLITHER_TRIAGE.md`**. Baseline at 3B-2 was exactly **1 acknowledged finding**
(now **7** — 5B acknowledged 2× `divide-before-multiply` in the dispute split; 6A/6B
acknowledged 2× `incorrect-equality` idle-epoch guards + 2× `calls-loop` registry
reads in the rewards epoch)
(`arbitrary-send-erc20` in `JobEscrow.createJob` — MATCHING_ENGINE-gated, bounded by each
requester's allowance; the documented trusted-gateway model, runbook §2). The job goes
red-but-allowed only when findings exceed the baseline — i.e. red == new finding to triage.
No inline `slither-disable` comments in contracts, ever.

**Slice 4 (4A merged #28, 4B #29) — reputation completeness (Stage B opener).**
The spec's full 5-dimension score (`querais_reputation_system.md` §2), all gateway-side —
no contract changes, no redeploy; the chain keeps the single uint16 composite:
- **Composite = 0.40·Accuracy + 0.25·Uptime + 0.15·Latency + 0.10·Longevity + 0.10·Stake**,
  computed in `gateway/src/reputation.ts` (pure dimension functions + `ReputationService`).
  The pool feeds matching the composite (`matching/` unchanged — still pure); `/v1/nodes`
  exposes the full dimension breakdown.
- **Telemetry (migration 5):** TTFT stamped per job (`jobs.first_token_ms`, pass AND fail);
  uptime from WS connect/disconnect session intervals (`node_sessions`) + `ws` built-in
  ping/pong keepalive (dead-TCP detection + `last_seen`; zero wire/daemon changes);
  accuracy-EMA working state (`node_reputation`, seeded 7000, NEVER from the on-chain
  score — that's the composite and would double-count); snapshot history
  (`reputation_snapshots`).
- **The dispatcher records outcomes** (single point that knows provider + verdict for both
  venues); **settlement classes move money only** — per-pass EMA chain writes are gone.
- **Daily on-chain snapshots (4B):** `ReputationService.snapshotAll()` on a timer
  (`GATEWAY_REPUTATION_SNAPSHOT_INTERVAL_SECONDS`, default 86400; e2e runs it at 2s)
  publishes every known node via `updateReputation` (receipt-checked). The failure path
  publishes IMMEDIATELY after the slash (Stake reflects it). **Rapid decline** (composite
  drop >2000 bps in any 7-day window) → manual-review flag: log + metric + snapshot-row
  flag, deliberately NO auto-slash/chain effect.
- 10th e2e scenario: a slow-first-token node (~1200ms) grades Latency 0.75, the snapshot
  timer lands the composite on-chain, and the registry score equals the recomputed
  weighted dimension sum.

**Slice 5 (5A #30 · 5B #31) — Layer-A verification + the on-chain challenge hook.**
5A — the gateway oracle:
All gateway-side (`gateway/src/oracle/`), no contract changes; migration 6:
- **Semantic sampling** of settled jobs (default 5%, `GATEWAY_LAYER_A_SAMPLE_RATE`;
  fire-and-forget from the dispatcher — never blocks or fails a request): re-run the
  prompt on oracle-controlled inference (`GATEWAY_LAYER_A_ORACLE_RUNS`, default 2) and
  compare **embedding cosine similarity**. The MAX similarity across runs decides —
  every oracle run must disagree with the provider to flag (2-of-N redundancy).
  Spec thresholds: ≥0.85 pass (no double-count) · 0.70–0.85 soft (accuracy EMA α=0.005)
  · <0.70 anomaly (α=0.05 + manual-review flag). **Flags never auto-slash.**
- **Pattern detection** on a sweep timer (`GATEWAY_PATTERN_SCAN_INTERVAL_SECONDS`,
  default 1h), derived from job rows (jobs now persist `result_hash` + `finish_reason`):
  identical output hash across ≥3 distinct prompts (a caching cheater — distinct jobId ⇒
  distinct prompt), and (near-)always-`length` truncation over ≥10 jobs. One open flag
  per ongoing pattern (no re-flag spam).
- **Prompt privacy:** sampled prompts/outputs live only in memory; the DB stores
  verdicts + hashes (`layer_a_checks`, `node_flags`). `/v1/nodes` exposes a `flags` count.
- **Seams:** `OracleInference` + `EmbeddingProvider` (Ollama impls for production via
  `GATEWAY_ORACLE_OLLAMA_URL`/`GATEWAY_ORACLE_EMBED_MODEL`; injected fakes in tests/e2e
  via `BuildOptions.layerA`). Sampling is OFF unless one of those exists.
- 11th e2e scenario: a canned-output cheater passes Layer-B; sampling collapses its
  accuracy EMA + flags it, the pattern sweep catches the duplicate hashes, and the node
  keeps serving (manual review, not eviction).

5B — the challenge hook (the first NEW contract since 2A; design signed off):
- **`DisputeResolution.sol`** (FAST track only; panel/commit-reveal stay Phase 5):
  `raiseDispute` (50-QAIS bond; evidence = content hash, never text on-chain),
  `submitCounterEvidence` (24h window, NOT pausable — a pause can't silence a defense),
  oracle-only `autoResolve` — challenger wins → **20%-of-stake slash split 50% burn /
  30% challenger / 20% treasury** via the new `NodeRegistry.slashTo` (SLASHER-gated
  proceeds routing) + bond returned; provider wins → bond burned. `reclaimBond` after
  30d unresolved (pause never traps funds). Disputes act on STAKE, not escrow —
  Layer-A is post-settlement, so JobEscrow is unchanged.
- Gateway hook: `GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY` (default off) makes every anomaly
  raise + auto-resolve on-chain (lazy max-approval for bonds; non-fatal — the
  manual-review flag stands if the chain write fails). Auto-disabled on manifests
  without the contract. `ops:pause` covers the 4th contract (skips pre-5B manifests).
- **The Sepolia deployment predates 5B** — disputes are OFF there until the operator
  redeploys (NodeRegistry gained `slashTo`); copy-pasteable steps in runbook §7b.
- 12th e2e scenario: anomaly → on-chain dispute → the slash lands and splits exactly
  (burn/challenger/treasury verified to the wei; total supply shrinks).

**Slice 6A (merged #33) — ProtocolTreasury + burn (tokenomics core).**
- **`ProtocolTreasury.sol`**: fees accrue as plain ERC-20 transfers (the contract simply
  replaced the treasury EOA as fee recipient — settlement code untouched); a
  keeper-called **`distribute()`** sweeps the **60/20/20 ops/staker/burn** split once
  per epoch. Accumulate-and-sweep, NOT the spec's per-settlement `receiveFee` (same
  economics, no token ops on the hot path). `opsRetainedWei` + `stakerEarmarkWei` fully
  explain the balance — a sweep can never re-split what earlier sweeps kept, and
  `allocate()` (cold-admin ops spending) can never dip into the staker earmark, which
  parks in-contract until 6B (`setStakerPool` flushes it). Rates admin-tunable with
  `burn + staker <= 10000`. Pausing blocks distribute/allocate (protocol funds only —
  no user exit to keep open; runbook §5 table).
- Fresh deploys point every fee-payer's constructor at the treasury contract; live
  chains migrate reversibly via the existing `setTreasury` (runbook §7c). The gateway
  holds KEEPER_ROLE and sweeps on a daily timer
  (`GATEWAY_TREASURY_DISTRIBUTE_INTERVAL_SECONDS`; reads `pendingDistribution()` first
  so empty epochs are quiet no-ops; auto-disabled on pre-6A manifests).
- **6B decision (taken): Option 1** — node-operator stakes are the stakers.
- 13th e2e scenario: fees accrue → the keeper timer sweeps unprompted → supply shrinks
  by exactly the burn; earmark/ops split conserves to the wei.

**Slice 6B (merged #34) — StakingRewards (Option 1: node-operator stakes).**
- **`StakingRewards.sol`**: the treasury's 20% staker share flows here
  (`treasury.setStakerPool`, wired at deploy); a keeper `distributeEpoch()` walks the
  ACTIVE node set fully on-chain and credits `claimable` pro-rata to stake; operators
  pull with **`claim()` — deliberately NOT pausable** (earned rewards are a user exit
  and survive later slashes/unbonding: a token debt, not stake). Division dust rolls
  to the next epoch; credited amounts conserve exactly. Documented trade-offs:
  staked-at-sweep-time membership (no intra-epoch time-weighting; fine at daily
  epochs) and O(n) registry reads per epoch (Merkle-epoch distributor is the deferred
  scale-out). The gateway keeper tick runs treasury sweep → epoch credit in order
  (same interval knob); `/v1/nodes` exposes `claimableRewardsWei`.
- Test-fixture nuance: `helpers.deploy()` does NOT call `setStakerPool` (the treasury
  unit tests need parked-earmark semantics); `deploy.ts` DOES — production wiring is
  fee → sweep → epoch credit → claim from day one on fresh chains.
- 14th e2e scenario: fees → sweep → pro-rata credit lands unprompted → the node
  operator claims; balance grows by exactly the credited amount.

**Slice 6C (merged #35) — node incentive programs (ops, not protocol).**
- The gateway COMPUTES, the operator PAYS: `gateway/src/incentives.ts` derives payout
  recommendations from Slice-4 telemetry + chain state, served by admin-gated
  `GET /v1/admin/incentives`; the operator executes each line from the COLD key via
  `pnpm ops:allocate` (`contracts/scripts/allocate.ts`, pause.ts-style tsx+viem,
  receipt-checked, refuses amounts beyond the spendable ops share).
- Three programs (formulas + flow in **`docs/INCENTIVES.md`**): uptime pool (equal
  split among ≥95%-uptime actives, × the spec's tenure multiplier 1.00/1.05/1.15/1.25
  at 0/30/60/90d), first-model bonus (earliest verified provider per model, from job
  rows), bootstrap launch bonus (earliest N actives with ≥30d tenure; 5,000 QAIS per
  go-to-market). Budgets/thresholds env-tunable (`GATEWAY_INCENTIVE_*`).
- **Paid-state is derived from chain**: one-time bonuses dedup against on-chain
  `Allocated(recipient, amount, purpose)` events via canonical purpose strings — no
  payout table to drift (thin-DB rule).
- 15th e2e scenario: job → recommendation appears → the REAL `ops:allocate` script pays
  it (cold key) → balance grows exactly → the purpose dedups it out of the next query.

**Slice 7A (merged #37) — deploy-ready gateway (code-side; live hosting is 7B/operator).**
- **Graceful drain**: `main.ts` traps SIGTERM/SIGINT → `app.close()`, whose onClose hook
  already flushes pending batched debits (money owed to nodes) in one `batchSettle`, then
  releases SQLite. `GATEWAY_SHUTDOWN_GRACE_MS` (default 25s) force-exits if drain overruns;
  size the platform's SIGTERM grace window above it (runbook §7d). 16th e2e scenario:
  accrue debits below the flush threshold → graceful close → exactly one on-chain
  `batchSettle` drains them.
- **Readiness vs liveness**: `/ready` now actually probes the RPC (`latestBlockTimestamp`)
  + DB and returns **503** when either is down (load balancers drain the instance);
  `/health` stays a cheap liveness check.
- **Backup/restore**: `GatewayDb.backupTo()` uses `VACUUM INTO` (atomic, WAL-safe);
  `db/backup.test.ts` is the automated restore drill (committed state survives crash +
  restore; the post-backup RPO window is the 2C reconcile path's job). `litestream.yml`
  for continuous off-box shipping (RPO ≤ ~10s).
- **Docker hardening**: non-root `USER node`, HEALTHCHECK, and the **single-instance**
  constraint documented (node:sqlite is single-writer; all timers assume one owner).
- Runbook **§7d** is the operator deploy + custody procedure.

**Deferred (do NOT assume these exist):**
- Slice 7B (live hosting — operator), Slices 8–9, Stage D.
- `DisputeResolution.sol`, `ProtocolTreasury.sol` — 0% built (specs in
  `querais_smart_contracts.md` §5–6). Fees currently go to a flat treasury EOA.
- Phase 4/5: libp2p, on-chain auction, decentralized oracle, TEE privacy, mainnet/TGE, DAO.
- Dependency majors (zod 4, openai 6, ts 6, …) — deliberate; Dependabot ignores npm majors.

---

## 4. Repo layout (pnpm monorepo, TypeScript ESM)

```
packages/
  contracts/    Solidity 0.8.28 + Hardhat 3. QUAISToken, NodeRegistry, JobEscrow,
                CreditAccount, DisputeResolution (+ reentrancy test mocks).
                deployments/addresses.<network>.json. scripts/{pause,split-admin}.ts ops
                CLIs (tsx+viem, no HH runtime). 65 tests (conservation, guards,
                reentrancy, EIP-712 parity, pausability, dispute economics, gas).
  shared/       @querais/shared — JobSpec/jobId, OpenAI schemas, wire protocol, pricing
                (basis-point), EIP-712 spending-cap sign/recover, chain bindings. 21 tests.
  matching/     @querais/matching — pure scorer (0.5·price + 0.5·reputation), no chain IO. 6 tests.
  gateway/      @querais/gateway — Fastify OpenAI API. src/{server,dispatcher,node-pool,
                settlement,batched-settlement,reputation,verify,chain-client,quota,
                session-status,key-store,faucet,metrics,config,auth,http}.ts
                + oracle/{layer-a,embeddings,patterns}.ts + routes/* + db/{index,
                migrations,jobs,sessions,ledger,node-sessions,node-reputation,
                reputation-snapshots,layer-a-checks,node-flags}.ts. 98 tests.
  node-daemon/  @querais/node-daemon — Ollama inference, encrypted keystore, auto-pricing,
                auto-faucet, auto-reconnect. 19 tests.
  sdk/          @querais/sdk — OpenAI-shaped client (+ `openSession`, `sessionStatus`)
                + `querais` CLI. 6 tests.
  test-e2e/     harness + 16-scenario acceptance gate + live/ops scripts.
apps/dashboard/ placeholder (the live dashboard is served by the gateway at `/`)
docs/EXECUTION_PLAN.md   the live roadmap (what we're following)
docs/RUNBOOK_KEYS.md     key custody + emergency pause runbook (2am copy-pasteable)
docs/SLITHER_TRIAGE.md   Slither setup rationale + acknowledged/excluded findings
docs/SLICE1_PLAN.md      thin-DB principle + node:sqlite rationale
docs/PHASE3_PLAN.md      broader workstream catalogue
querais_*.md             the 7 original design/whitepaper docs — read for intent
```

**Most load-bearing files:** `contracts/CreditAccount.sol` + `JobEscrow.sol`,
`shared/src/spending-cap.ts` (EIP-712 — must mirror the contract), `gateway/src/dispatcher.ts`
(match → venue choice → stream → verify → settle), `gateway/src/batched-settlement.ts`
(ledger/flush/reconcile/canAccrue), `gateway/src/reputation.ts` (the 5-dimension oracle),
`gateway/src/quota.ts`, `gateway/src/db/migrations.ts`
(**6 migrations** — append-only, never edit released ones), `test-e2e/src/e2e.ts`.

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
   in ONE `batchSettle`; escrow → `completeJob` → `verifyAndRelease` (95/5). Settlement
   moves money ONLY; refund + slash on failure.
8. Reputation (Slice 4): the dispatcher folds the verified pass/fail into the gateway-side
   accuracy EMA and refreshes the pool's composite; the chain gets the composite via the
   daily snapshot sweep — or immediately after a slash.
9. Layer-A (Slice 5A): ~5% of settled jobs are re-run on oracle inference and compared by
   embedding cosine similarity (fire-and-forget); anomalies hit the EMA (α=0.05) and land
   a manual-review flag. A pattern sweep flags caching/truncation cheaters from job rows.

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
- **Settlement moves money only; snapshots own the reputation chain writes.** (4B.) The
  dispatcher records outcomes into the gateway-side accuracy EMA; `updateReputation` is
  called only by the daily snapshot sweep + the immediate post-slash publish. The accuracy
  EMA is NEVER seeded from the on-chain score (that's the composite — double-counting).
  Rapid decline flags for MANUAL review only — no auto-slash. (Slice 4.)
- **Layer-A flags are manual-review only — never an auto-slash** (spec §6.2: anomaly →
  review/dispute, not punishment), and **sampled prompts/outputs never persist** (the DB
  stores verdicts + hashes only). Sampling must never block or fail a request. (5A.)
- **`matching` stays pure** (no chain IO) so it can move on-chain in Phase 4.
- **The gateway DB is a thin cache/index, never the source of truth for value/trust.**
- Keep changes **additive via the existing seams**: `Settlement`, `InferenceBackend`,
  `ApiKeyStore`, `FaucetDistributor`, `GatewayDb`/stores, `NodePoolOptions`,
  `HardeningConfig`, `loadAddresses(network)`, the WS transport.

---

## 7. Run & verify (commands)

From the repo root, any OS — these run identically on the maintainer's Windows box, a
Linux remote/cloud agent, and CI. First: `cp .env.example .env` (localhost/e2e need only
the well-known Hardhat dev accounts shipped in the example — no real secrets). On
Windows, return to the repo root if a previous Hardhat command ran — see §8.

```
pnpm install
pnpm build               # REBUILD BEFORE test:e2e after editing gateway src — e2e consumes dist/!
pnpm typecheck
pnpm lint                # eslint + prettier --check  (run `pnpm exec prettier --write .` first!)
pnpm test                # all unit tests (109 TS + the 55-test contract suite)
pnpm test:e2e            # self-contained: fresh local chain → 16 scenarios (~65s)
pnpm demo                # local human demo (real Ollama + dashboard)
```
Sepolia (needs real keys — local operator only, see §12): `pnpm preflight:sepolia` →
`pnpm deploy:sepolia` (full) or `pnpm deploy:credit:sepolia` (additive). Hosted test:
`pnpm gateway:sepolia` + node scripts; `pnpm prepare:vm-node` auto-funds a node key.

**Green bar = build + typecheck + lint + test + test:e2e.** CI runs the same on every PR
(+ solhint); a PR must be green to merge.

---

## 8. Environment traps (these already cost time)

Cross-platform traps first; the PowerShell/Windows ones apply only to the maintainer's
local checkout (a Linux remote agent or CI can skip those).

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
- **Hardhat 3:** `defineConfig`, `network.connect()`, solc 0.8.28/cancun. No coverage tool.
  Slither can't drive HH3 (crytic-compile `KeyError: 'output'`) — CI runs it on a
  symlink-free scratch copy instead (3B-2, `docs/SLITHER_TRIAGE.md`). Beware: a failed
  `slither .` attempt runs `npx hardhat clean` — rebuild before testing.
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
`GATEWAY_WS_MAX_MESSAGES_PER_SECOND`. Slice 4 added `GATEWAY_WS_PING_INTERVAL_MS`
(keepalive cadence) and `GATEWAY_REPUTATION_SNAPSHOT_INTERVAL_SECONDS` (daily epoch).
Slice 5A added `GATEWAY_LAYER_A_SAMPLE_RATE`, `GATEWAY_LAYER_A_ORACLE_RUNS`,
`GATEWAY_PATTERN_SCAN_INTERVAL_SECONDS`, `GATEWAY_ORACLE_OLLAMA_URL` (unset ⇒ sampling
off), `GATEWAY_ORACLE_EMBED_MODEL`. Slice 5B added `GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY`
(default off; needs a 5B deployment + gateway QAIS for bonds). Slice 6A added
`GATEWAY_TREASURY_DISTRIBUTE_INTERVAL_SECONDS` (daily sweep; auto-off pre-6A);
6C added the `GATEWAY_INCENTIVE_*` budget/threshold knobs (see `docs/INCENTIVES.md`).

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

Persistent memories live on the maintainer's local machine
(`~/.claude/projects/C--Users-mynew-Desktop-querais/memory/`) — remote agents don't have
them and don't need them; this file + `docs/EXECUTION_PLAN.md` carry everything required.

---

## 12. Loose ends / current runtime state

- **Stage A complete; Slice 4 Reputation complete** — `main` is at #29 (Slice 4B
  snapshots). Next: **Stage B, Slice 5 Layer-A verification** (scope in §2). No slice PR
  is open.
  **Verify with `gh pr list` + `git log origin/main --oneline -3` before acting** — a
  parallel session may have changed state since this file was written.
- **Remote agents (no local files): what you can and cannot do.**
  - ✅ Everything code-side: the full green bar (incl. e2e — it spawns its own local
    chain), new slices, PRs. `cp .env.example .env` is all the setup needed; CI proves
    the whole flow works on a fresh Ubuntu box.
  - ❌ Anything needing real keys: Sepolia deploys, `pnpm gateway:sepolia`, pause/rotation
    drills, the faucet. The hot gateway key and cold admin key live ONLY in the
    maintainer's local `.env` (gitignored) — they are not in this repo, by design. If a
    slice needs a live Sepolia action, build + test it against localhost/e2e and leave
    the operator a copy-pasteable command list (pattern: `RUNBOOK_KEYS.md` §7).
  - The same merge rule applies: open a PR, get CI green, **ask the user to merge**.
- The **Sepolia key split is already executed on-chain** (it's an on-chain fact, not tied
  to any PR): pause/rotation need the cold `ADMIN_PRIVATE_KEY` from the maintainer's
  `.env`. Dependabot PR #20 is open with CI red (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`)
  — the supply-chain age policy working as designed; leave it until the package ages in.
- **No hosted gateway/VM node is running** — restart with `pnpm gateway:sepolia` + the node
  scripts if needed (local operator; the VM restart recipe is in the maintainer's notes).
- The "ultra one-liner" installer still needs the repo (ShavitR/querais, private) to go
  public — a user decision, likely Slice 9.
- Counts that tests assert or reports cite: e2e = **16 scenarios**, gateway unit = **107**,
  contracts = **81**, TS unit total = **160** (incl. 1 Ollama-gated node-daemon skip),
  migrations = **6** (`MIGRATION_COUNT` tracks automatically).

---

## 13. Your first 5 minutes (suggested)

1. Read this file + `docs/EXECUTION_PLAN.md`.
2. `git fetch; git log origin/main --oneline -5; gh pr list` — confirm open-PR state.
3. From the repo root: `cp .env.example .env; pnpm install; pnpm build; pnpm test` → green.
4. `pnpm test:e2e` → 16 scenarios pass (self-contained, ~65s).
5. Skim `dispatcher.ts`, `batched-settlement.ts`, `reputation.ts` (the Slice 4 oracle),
   `verify.ts` (Layer-B — Slice 5 builds Layer-A above it), `CreditAccount.sol`,
   `e2e.ts`, and `docs/RUNBOOK_KEYS.md`.
6. Plan Slice 5 (scope in §2 + EXECUTION_PLAN), confirm it with the user, then follow
   the rhythm in §2.
