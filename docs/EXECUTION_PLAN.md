# QueraIS — Execution Plan (opinionated sequencing)

> This is the **execution ordering** I recommend we actually work through, with a clear
> rationale for *why this order*. It is a companion to `docs/PHASE3_PLAN.md` — that file is
> the full catalogue of workstreams (P3.1–P3.14); this file is the **path through them**.
> Where the two disagree on sequencing, this file is the one we're following.

## Objective (chosen)

**Both, in that order:** make the marketplace *protocol* complete and credible first, then
operate it as a hosted public testnet. We invest in protocol depth before we invest in
running a 24/7 service — there's no point paying to host something whose core mechanic isn't
real yet.

## The thesis (why this order, not the catalogue's order)

Two facts drive the sequencing:

1. **The biggest gap between the whitepaper and the code is batched session-deposit
   settlement.** Today every API call is 1–2 on-chain txs (`createJob` + `verifyAndRelease`).
   That's a working demo, not a marketplace. The docs' entire economic design (pre-funded
   credit accounts, EIP-712 signed spend, `batchSettle`) is **specified but unbuilt**. This
   is the highest-value, most-interesting work, and everything economic depends on it.
2. **Deploy/host is the easy, ongoing-cost, ops-burden part.** Nothing is worth hosting 24/7
   until state is durable and settlement is real. So hosting comes *after* the core is sound,
   not first (this is where we diverge from `PHASE3_PLAN.md`'s M3.A, which opens with infra).

We therefore sequence by **what de-risks the protocol**, and treat "operate a hosted service"
as a deliberate later stage.

## Guiding principles

- **Additive via existing seams** — reuse `Settlement`, `ApiKeyStore`, `FaucetDistributor`,
  pure `matching`, `InferenceBackend`, `loadAddresses(network)`, the gateway↔node WS transport.
  No rewrites.
- **Gate every slice** — `build · typecheck · lint · test · test:e2e` must stay green, plus
  the slice's own acceptance criteria. From Slice 0 on, that gate runs in CI.
- **Durable before scalable before fancy**, but **real-mechanic before durable-infra** —
  persistence and settlement correctness come before hosting and horizontal scale.
- **Security proportional to openness** — harden the open surface *before* strangers touch it.
- **Honest reporting** — each slice reports what passed/failed with evidence; no overclaiming.

---

## Stage A — Foundation (robust to either objective)

These four slices are the same no matter what we build on top. They make state durable,
settlement real, and the surface safe. Do all four before opening anything publicly.

### Slice 0 — Lock the green bar into CI + static analysis · Effort S · Risk L · ✅ DONE
- **Goal:** every change is gated before we start mutating money-moving contracts.
- **Built:** GitHub Actions (`.github/workflows/ci.yml`) running `build/typecheck/lint/test/
  test:e2e` on PR (blocking), **solhint** as the blocking Solidity gate, **coverage** (node:test,
  non-gating), **pnpm audit** + **Dependabot** (non-gating). Required Node ≥22.13 (pnpm 11.5.2
  uses `node:sqlite`).
- **Acceptance (met):** a PR is blocked on red CI (verified: a failing test turned the gate red);
  the e2e gate runs headless on Ubuntu (verified green); solhint blocks on Solidity errors
  (0 today).
- **Deferred — Slither:** driving solc directly under pnpm trips solc `--allow-paths` on the
  symlinked `.pnpm` store, and Slither's framework auto-detect doesn't support Hardhat 3 yet.
  → **Resolved in Slice 3B-2** via a symlink-free scratch copy (see that slice and
  `docs/SLITHER_TRIAGE.md`). Still deferred: contract-line **coverage** (no HH3-compatible
  tool); GitHub **secret scanning** (a repo setting, not code).
- **Maps to:** P3.14 (core) + P3.5 (static-analysis item), pulled early.

### Slice 1 — Persistence behind repositories · Effort L · Risk M · ✅ DONE
- **Built (merged #15):** `GatewayDb` on Node's built-in `node:sqlite` (zero new deps, behind a
  repository seam). API keys + faucet claims durable (faucet throttle now an atomic, restart-proof
  `INSERT`); job records persisted from the dispatcher (non-fatal writes); usage derived from
  settled rows. New `GET /v1/usage`, enriched `GET /v1/jobs/:id`. DB stays a thin cache/index —
  on-chain remains the source of truth. Detail in `docs/SLICE1_PLAN.md`.
- **Goal:** stop losing state on restart; give batching a durable ledger to write to.
- **Build:** a DB (SQLite dev / Postgres prod) behind small repositories. Persist **API keys**
  (replace `ApiKeyStore` JSON), **job records** (jobId, requester, provider, tokens, status,
  settlement tx, timestamps), **usage/credits** per key, **faucet claims** (replace the
  in-memory `Set` — a real hole today), **node history**. Migrations. Dispatcher/settlement
  write job rows; `/v1/jobs/:id` and `/v1/usage` read from DB + chain.
- **Acceptance:** keys/jobs/faucet-claims survive restart; `/v1/usage` returns per-key history;
  any job is auditable end-to-end.
- **Maps to:** P3.2.

### Slice 2 — Batched session-deposit settlement ⭐ · Effort L · Risk H
- **Goal:** make per-call cost ≈ 0 and turn the demo into a marketplace.
- **Build:** `CreditAccount.sol` (deposit → EIP-712 signed spending cap → `batchSettle([...])`
  → withdraw-after-notice); an off-chain **signed debit ledger** (persisted, Slice 1); a
  **batch settler** implementing the existing `Settlement` interface as `BatchedSettlement`
  (flush every N sec / M jobs), keeping per-job as fallback. Conservation + cap + revoke tests;
  a **gas-per-job benchmark**; a new e2e scenario.
- **Acceptance:** 100 calls settle in 1 tx; requester signs **zero** per-call wallet txs;
  worst-case loss bounded (settle only at signed prices; no principal theft); `pnpm test:e2e`
  gains a batched-settlement scenario.
- **Why this is the marquee work:** it's the gap between the whitepaper and reality, and
  everything economic (tokenomics, node earnings at volume) sits on top of it.
- **Maps to:** P3.3.

### Slice 3 — Harden the open surface · Effort M · Risk H · ✅ DONE (3A+3B-1+3B-2)
- **Goal:** survive an adversarial internet *before* exposing anything.
- **Built — 3A (merged #25):** persistent IP+address faucet throttle + daily cap +
  distributor balance guard; per-key **quota tiers** (429 with headers); prompt-abuse
  limits; WS flood/conn caps; e2e hardening scenario.
- **Built — 3B-1 (merged #26):** `docs/RUNBOOK_KEYS.md` (key inventory, blast radius,
  incident response, rotation, drill log); `scripts/pause.ts` incident CLI (tsx+viem, no
  HH runtime, receipt-checked, idempotent); `test/Pausable.ts` pinning pause semantics
  (exit/refund paths stay open while paused); e2e pause drill (9th scenario, real script);
  `GET /v1/sessions` + SDK `sessionStatus()`; **executed Sepolia admin/pauser key split**
  (cold EOA `0x85cC...9dE8` holds ADMIN+PAUSER; hot gateway key holds neither) + **live
  Sepolia pause/unpause rehearsal** (time-to-pause 10.5s, drill log entry #2).
- **Acceptance (met):** the faucet can't be drained by one actor across restarts; quotas
  enforce; the "gateway key leaked" drill has a runbook; pausing contracts is rehearsed —
  both locally (re-runs on every `pnpm test:e2e`) and live on Sepolia.
- **Built — 3B-2 (`slice-3b-slither`):** the Slice 0 Slither deferral, closed. Non-gating
  `slither` CI job (slither-analyzer 0.11.5 + solc 0.8.28) on a **symlink-free scratch
  copy** of the contracts (crytic-compile still can't parse HH3 build-info, and
  `--allow-paths` rejects pnpm's symlinked store — evidence in `docs/SLITHER_TRIAGE.md`).
  Triage config `packages/contracts/slither.config.json`; baseline = exactly **1
  acknowledged finding** (`arbitrary-send-erc20` in `JobEscrow.createJob`, the documented
  trusted-gateway model); the job goes red only when NEW findings appear.
- **Maps to:** core of P3.5.

---

## Stage B — Protocol depth (the "credible protocol" half of the objective)

With a durable, batched, hardened core, make the *mechanics* whole. This is what makes the
protocol credible as a complete design rather than a demo.

### Slice 4 — Reputation completeness · Effort M · Risk L · ✅ DONE (4A #28 · 4B)
- **Goal:** the full multi-dimensional reputation from the design docs (today: accuracy EMA only).
- **Built — 4A (merged #28), telemetry + composite:** migration 5 (`jobs.first_token_ms`,
  `node_sessions`, `node_reputation`, `reputation_snapshots` DDL); new
  `gateway/src/reputation.ts` — pure dimension functions + `ReputationService`;
  **Composite = 0.40·Accuracy + 0.25·Uptime + 0.15·Latency + 0.10·Longevity + 0.10·Stake**.
  Uptime from WS connect/disconnect session intervals + `ws` ping/pong keepalive (no wire
  changes); Latency = graded TTFT P95 over 30d, derived from job rows; Longevity from
  on-chain `registeredAt` with 30d-inactivity decay; Stake = min(1, stake/10k QAIS);
  accuracy EMA state gateway-side, seeded 7000, never from the on-chain score. The
  dispatcher records pass/fail outcomes; the pool feeds matching the composite
  (`matching/` unchanged); `/v1/nodes` exposes the dimension breakdown.
- **Built — 4B, snapshots own the chain:** settlement classes move **money only** (per-pass
  EMA chain writes stripped); `ReputationService.publishNow`/`snapshotAll` publish the
  composite via `updateReputation` (receipt-checked) on a daily timer
  (`GATEWAY_REPUTATION_SNAPSHOT_INTERVAL_SECONDS`, e2e runs it at 2s); failure path
  publishes immediately after the slash (Stake reflects it); **rapid-decline** (>2000 bps
  drop in any 7-day window) → manual-review flag (log + metric + snapshot-row flag, NO
  auto-slash); snapshot history in `reputation_snapshots`; new oracle metrics. 10th e2e
  scenario: slow-first-token node graded to 0.75 Latency, the timer lands the snapshot
  on-chain, the registry score equals the recomputed weighted dimension sum.
- **Acceptance (met):** a flaky/slow node's score reflects it (failure + reputation e2e
  scenarios); scores snapshot on-chain on the daily epoch timer; matching uses the composite.
- **Maps to:** P3.7.

### Slice 5 — Verification depth (Layer-A) · Effort L · Risk H · ✅ DONE (5A #30 · 5B #31)
- **Goal:** catch cheating beyond Layer-B, since strangers run nodes.
- **Built — 5A (gateway oracle, no contract changes):** **Layer-A semantic sampling**
  (`gateway/src/oracle/`) — re-run ~5% of settled jobs (`GATEWAY_LAYER_A_SAMPLE_RATE`) on
  oracle-controlled inference (N=2 runs; the MAX similarity decides, so every run must
  disagree to flag — 2-of-N redundancy) and compare **embedding cosine similarity** (NOT
  cross-node hash matching — temp=0 isn't deterministic across hardware; load-bearing,
  HANDOFF §6). Spec thresholds: ≥0.85 pass · 0.70–0.85 soft (EMA α=0.005) · <0.70 anomaly
  (EMA α=0.05 + manual-review flag — never an auto-slash). **Pattern detection** from job
  rows on a sweep timer: identical `result_hash` across ≥3 distinct prompts (caching
  cheater), (near-)always-`length` truncation. Verdicts in `layer_a_checks`; flags in
  `node_flags` (surfaced as a count on `/v1/nodes`); prompts/outputs never persisted
  (privacy) — hashes only. Ollama-backed `OracleInference`/`EmbeddingProvider` impls for
  production; injectable seams for tests/e2e. Migration 6. 11th e2e scenario: a
  canned-output cheater passes Layer-B, sampling + patterns catch it.
- **Built — 5B (challenge hook, design signed off):** **`DisputeResolution.sol`** —
  `raiseDispute(jobId, defendant, evidenceHash)` with a 50-QAIS challenger bond,
  `submitCounterEvidence` (24h window, NOT pausable — a pause can't silence a defense),
  oracle-only FAST-track `autoResolve`: challenger wins → 20%-of-stake slash routed
  **50% burn / 30% challenger / 20% treasury** via the new `NodeRegistry.slashTo`
  (SLASHER-gated proceeds routing) + bond returned; provider wins → bond burned.
  `reclaimBond` escape hatch after 30d (pause never traps funds). Disputes act on STAKE,
  not escrow — Layer-A samples settled jobs, so payment already moved; **no JobEscrow
  changes** (deviation from the original sketch, explained in the PR). Gateway: anomalies
  optionally raise + auto-resolve on-chain (`GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY`,
  default off; auto-disabled on pre-5B manifests). Sepolia activation = operator
  redeploy (runbook §7b). Full arbitration panel stays Phase 5.
- **Acceptance (met):** a plausible-but-wrong node is flagged by sampling ✅; a
  pattern-cheater is caught ✅; a dispute can be raised and auto-resolved for clear
  cases ✅ (12th e2e scenario: slash lands + splits exactly on-chain).
- **Maps to:** P3.8.

### Slice 6 — Tokenomics activation (testnet) · Effort M · Risk M · ✅ DONE (6A #33 · 6B #34 · 6C #35)
- **Goal:** turn on the economic loops (today: fee → a single treasury EOA).
- **Why the split:** as one slice this secretly contains a *new staking contract* (6B) and
  an *ops program* (6C) hiding behind the treasury work (6A). Same lesson as 2A/2B/2C and
  3A/3B: ship the small clean core first, keep each PR independently green.
- **6B decision (taken):** Option 1 — node-operator stakes in `NodeRegistry` are the
  stakers (rewards pro-rata to active staked nodes). Rationale: pays the people securing
  the network and decentralizes the supply side; a passive token-holder pool decentralizes
  nothing that matters pre-Phase-4.
- **6A — `ProtocolTreasury.sol` + burn (BUILT #33; design confirmed):**
  - **Accumulate-and-sweep, NOT per-settlement splitting.** The spec's `receiveFee`
    (split + burn on every settlement) would add token ops + gas to every `batchSettle`
    on the hot path. Instead: fees keep arriving as the plain ERC-20 transfers they
    already are — the treasury *contract address* simply replaces the treasury EOA — and
    a keeper-called **`distribute()`** on a daily epoch (same timer pattern as the
    reputation snapshots) executes the **60/20/20** ops/staker/burn split in ONE tx.
    Same economics, fraction of the gas, zero changes to settlement code.
  - **Activation is additive + reversible:** deploy the treasury, then the cold admin
    calls the *existing* `setTreasury` on `JobEscrow` + `CreditAccount` (+ point
    `DisputeResolution`'s treasury share at it). No redeploys, instant rollback to the
    EOA if something's wrong. Operator command list per the runbook §7 pattern.
  - Rates admin-tunable (cold key) with `burn + staker <= 10000` enforced; until 6B
    ships, the staker share **parks in the treasury under an earmarked counter** (so 6A
    never blocks on 6B). Pause rule: pausing blocks `distribute()`/`allocate()`; the
    treasury holds protocol funds only, so no user exit path exists to keep open —
    state that explicitly in the Pausable test table.
  - **Acceptance:** fees accrue across settlements; one `distribute()` burns 20% (total
    supply measurably shrinks), earmarks/pays 20% to stakers, retains 60%; e2e scenario
    asserts the split conserves to the wei (the 5B conservation-test pattern).
- **6B — Staking rewards (BUILT #34; Option 1):** **`StakingRewards.sol`** — the
  treasury's staker share flows here (`setStakerPool`, wired at deploy); a keeper
  `distributeEpoch()` walks the ACTIVE node set on-chain and credits `claimable`
  pro-rata to stake; operators pull with `claim()` (NOT pausable — a user exit; earned
  rewards survive later slashes/unbonding). Discrete epoch crediting — no registry
  hooks; division dust rolls forward, conservation exact. Known trade-offs documented
  in-contract: staked-at-sweep-time membership (no intra-epoch weighting) and O(n)
  registry reads per epoch (Merkle distributor is the deferred scale-out path). The
  gateway keeper tick runs treasury sweep then epoch credit in order; `/v1/nodes`
  surfaces `claimableRewardsWei`.
- **6C — Node incentive programs (BUILT #35; ops, not protocol):** the gateway COMPUTES
  payout recommendations (`gateway/src/incentives.ts` + admin-gated
  `GET /v1/admin/incentives`); the OPERATOR executes them from the cold key via
  `pnpm ops:allocate` (`scripts/allocate.ts`). Three programs per the specs — uptime
  pool (equal split among ≥95%-uptime actives × tenure multiplier), first-model bonus
  (earliest verified provider per model, from job rows), bootstrap launch bonus
  (earliest N actives with ≥30d tenure, go-to-market's 5,000 QAIS). **Paid-state is
  derived from on-chain `Allocated` purposes** (canonical strings) — no payout table to
  drift. Formulas + operator flow: `docs/INCENTIVES.md`. No new contract logic.
- **Depends on:** Slice 2 (fees flow through batched settlement) ✓ and 5B (`slashTo`
  treasury routing) ✓.
- **Maps to:** P3.11.

---

## Stage C — Operate the service (the "host it" half of the objective)

Now there's something worth hosting. Stand up the real service and bring the world to it.

### Slice 7 — Production deploy & infra · Effort L · Risk M · ◐ DONE code-side (#37: 7A hardening + Fly pipeline) · live execution = operator
- **Framing that drives every choice here: the gateway DB is now money.** The pending-debit
  ledger is unsettled liabilities owed to nodes; bond/gas wallets fund disputes and
  settlement. Hosting is not "run the Docker image somewhere" — it's custody of that state.
- **7A (BUILT #37, code-side — what a remote agent can ship + test):** signal-driven graceful drain (SIGTERM → `app.close()` flushes pending debits; `GATEWAY_SHUTDOWN_GRACE_MS`), a real **`/ready`** probe (RPC + DB, 503 when down) vs liveness `/health`, Docker hardening (non-root, HEALTHCHECK, single-instance constraint documented), the **`VACUUM INTO` backup primitive** + an automated **restore drill** (`db/backup.test.ts`) + a Litestream config, and the operator runbook (§7d). 16th e2e scenario proves pending debits drain to one on-chain `batchSettle` on graceful shutdown.
- **Fly.io pipeline (BUILT #37, code-side):** `packages/gateway/fly.toml` (single
  machine on a single-writer volume, /health + /ready checks, immediate strategy,
  kill_timeout above the drain window), `.github/workflows/deploy.yml` (deploy after the
  CI green bar on main; opt-in via `DEPLOY_ENABLED` + `FLY_API_TOKEN`; secrets live on
  Fly, never in CI), and `docs/DEPLOY.md` (operator setup + drills). Chosen: Fly.io + a
  CI pipeline so the hot keys never enter the build environment.
- **7B (operator-only — the live EXECUTION, needs keys + a Fly account):** the actual hosted deploy (Fly.io/Railway/VPS, TLS, secrets, volume + continuous backup), the full-protocol Sepolia redeploy, the live restore + pause drills. A remote agent cannot perform these; the command lists are copy-pasteable.
- **Build:**
  - Host the gateway 24/7 (Fly.io / Railway / VPS) from `packages/gateway/Dockerfile`;
    TLS + domain; `/ready`/`/health` wired to the platform.
  - **Exactly ONE gateway instance.** `node:sqlite` is single-writer, and the flush /
    snapshot / sampling / pattern / dispute timers all assume a single owner — two
    instances would double-publish reputation and double-raise disputes (`settledJob`
    idempotency protects settlement, nothing protects the rest). Horizontal scale stays
    deferred (P3.6); enforce `max_instances = 1` in platform config and say why in a comment.
  - **Persistent volume + continuous off-box backup** (Litestream or platform snapshots,
    RPO ≤ 5 min). A **restore drill is part of the slice**, not an aspiration: kill the
    instance, restore from backup, prove settled state is intact and any lost-window
    pending debits are caught by the 2C reconcile-on-revert machinery.
  - **Graceful shutdown flushes pending debits** — verify the existing shutdown flush
    completes inside the platform's SIGTERM grace window (size the window to worst-case
    flush gas latency; document it).
  - **Secrets manager** for the hot keys (gateway/oracle/faucet) — never plaintext on
    disk. The cold admin + pauser keys NEVER touch the host (preserve the runbook §7
    custody model).
  - **Gas + dispute-bond hot-wallet gauges** with documented top-up procedure (Slice 8
    wires the paging; this slice exposes the numbers).
  - **Fold the Sepolia redeploy in here:** the live deployment predates 5B (and 6) —
    this slice's deploy ships the full current contract set + role wiring (runbook §7b)
    instead of doing a separate interim redeploy.
  - Re-run the **live pause drill against the hosted gateway** (runbook drill-log entry).
- **Acceptance:** public HTTPS URL serves `/v1/*`; a node connects over the internet;
  `kill -9` + restore-from-backup loses no settled state and ≤ 5 min of pending debits
  (reconciled automatically); a SIGTERM deploy drains to 0 pending debits; secrets never
  on disk in plaintext; pause drill executed against production.
- **Maps to:** P3.1.

### Slice 8 — Observability & SRE · Effort M · Risk M
- **Highest-value item: close the manual-review loop.** Slices 4/5 deliberately route
  cheating signals (rapid reputation decline, Layer-A anomalies, pattern cheaters) to
  "manual review" — but today a flag is a log line + metric and **nobody is paged**, so a
  flagged cheater keeps serving until someone happens to read logs. Build: `node_flags` +
  rapid-decline events → a real notification channel (email / Telegram / Discord webhook,
  behind a small seam), plus a minimal review queue (gateway endpoint + dashboard section
  listing open flags, mark-reviewed) — no new infra.
- **Build:** Prometheus scrape of `/metrics` (latency histograms, per-model counters,
  settlement success/fail); Grafana dashboards; structured logs → aggregation; a **public
  status page**; **alert rules** — including the money-shaped ones the catalogue misses:
  - **oldest-unflushed-debit age** (settlement stuck = nodes silently unpaid),
  - settlement failure rate, gas wallet balance, **dispute-bond wallet balance**,
  - faucet distributor balance (QAIS + ETH), Layer-A anomaly rate, open-flag count,
  - error rate, node-count drop.
- **Runbooks:** extend the `RUNBOOK_KEYS.md` pattern — every alert links a runbook with
  copy-pasteable 2am steps; an alert without a runbook doesn't ship.
- **Acceptance:** dashboard shows live jobs/nodes/gas; simulated gas-low + node-drop +
  stuck-debit events fire alerts; **an induced Layer-A flag reaches a human channel in
  < 5 min**; status page reflects an induced outage.
- **Maps to:** P3.4.

### Slice 9 — DX, node polish & growth · Effort L · Risk L
- **Build:** **signed installers / prebuilt release artifacts** (onboarding skips the source
  build); **model registry** with SHA256 verification; publish the **Python SDK** +
  **LangChain/LlamaIndex** providers; beta-cohort recruitment + leaderboard campaign.
  (The signup portal and operator dashboard moved to **Slice 10** — 10B/10C — and the
  docs site moved to **10E**, the Next.js content property, so each is built once in the
  right place; this slice keeps the release engineering and the campaign.)
- **Disclosures must match what the system actually does** (linked before the first key is
  issued): ToS + "testnet, no real value" framing, and a prompt-privacy disclosure that
  explicitly states (a) **~5% of prompts are re-run on oracle infrastructure** for
  verification (Layer-A sampling), (b) prompts/outputs are processed in memory and never
  persisted — hashes only, (c) verification anomalies can trigger on-chain disputes
  against providers. Burying (a) would look bad precisely when Layer-A catches its first
  real cheater in public.
- **Repo-public gate** (the one-liner installer needs `ShavitR/querais` public, and going
  public is irreversible — user signs off on a checklist):
  - mechanical secret scan over **all git history/refs** (gitleaks or trufflehog — the
    runbook says keys never lived in-repo; verify it, don't assume it),
  - GitHub secret scanning + push protection enabled; `SECURITY.md` with a disclosure
    contact; LICENSE chosen,
  - Slither baseline + `docs/SLITHER_TRIAGE.md` published as-is (honest > polished).
- **Acceptance:** a dev signs up → streamed completion via the official `openai` client in
  <5 min, no human contact; an operator installs from a release in <5 min with no build;
  disclosures linked before first key; history scan clean before the repo flips public.
- **Maps to:** P3.9 + P3.10 + P3.12 + P3.13.

---

## Stage D — Product & expansion (the chosen direction past the catalogue)

Stages A–C make the protocol complete, hosted, and observable. Stage D is where we chose
what to focus on next (this section is the decision, not a menu): first make everything
we built **visible and usable** — the protocol has sessions, reputation dimensions,
disputes, and burns that no human can currently see (today's "frontend" is a 124-line
inline-HTML page in `gateway/src/routes/dashboard.ts`, and `apps/dashboard` is an empty
placeholder) — then finish the **arbitration mechanic**, then buy **scale confidence**,
then assemble the **mainnet go/no-go package**. Rationale for the order: a real frontend
multiplies the value of every prior slice and is the adoption bottleneck for the Slice 9
growth push; arbitration is the last incomplete protocol mechanic; load testing must
precede any real volume; mainnet is a gate, not a feature.

### Slice 10 — The web app · Effort XL · Risk M · split 10A/10B/10C/10D/10E

One product, five shippable increments. **10A is the foundation; 10B/10C/10D are
independent once 10A lands** (they can interleave with Slices 6–8 if frontend energy is
available early — nothing in 10 blocks the protocol track except where noted). 10E is
fully independent of all of them.

**Two frontends, one boundary rule (decided):** pages a **crawler** should index live in
a **Next.js** marketing/docs site (10E) on the root domain, statically rendered and
deployed separately from the gateway; pages a **signed-in human or live data** needs live
in the **Vite app** (10A–10D) served by the gateway (e.g. `querais.xyz` vs
`app.querais.xyz`). The Next site never touches the money path — if it goes down, the
protocol doesn't notice; if it wants live numbers it fetches public read-only endpoints
at build/revalidate time (ISR), so the gateway needs no CORS opening. When a page is
ambiguous, ask "does it need a wallet, a key, or a WebSocket?" — yes ⇒ app, no ⇒ site.

- **10A — Foundation: the real app + auth · Effort M:**
  - Stand up the actual **Vite + React + TypeScript** app in `apps/dashboard` (the
    placeholder finally lands). Dark theme consistent with the current page; a small
    component kit (cards/tables/charts) — no heavyweight UI framework.
  - **Served by the gateway** at `/` from the app's built `dist/` (same-origin API ⇒ no
    CORS, no second app *server* — Slice 7's single-instance model holds; the only other
    deployment is 10E's static site, which has no server and no gateway access).
    The inline-HTML dashboard is **retired in the same PR** (one frontend, not two).
    CI gains the app's build + typecheck + lint; e2e gains a served-app smoke check.
  - **Auth model:** sign in with an **API key** (requester) or a **wallet signature**
    (node operator / requester wallet — sign-in-with-Ethereum style nonce, verified
    gateway-side; read-only public mode with no sign-in at all). Key never in
    localStorage in plaintext — session cookie minted by the gateway.
  - **Data layer:** typed client over the existing `/v1/*` routes (stats, nodes, jobs,
    usage, sessions, models) + a read-only WS or polling channel for live updates.
  - **Acceptance:** `pnpm build` produces the app; the gateway serves it at `/`; sign-in
    works with a key and with a wallet; the old page is gone; green bar includes the app.
- **10B — Requester console · Effort M:**
  - **Playground:** streaming chat with model picker + per-request cost readout (the
    cost calculator, live) — the current prompt box, grown up.
  - **Keys & usage:** create/list keys (tier visible), usage and quota charts from
    `/v1/usage` + the `x-querais-quota-*` headers.
  - **Jobs explorer:** job list + detail (status, tokens, settlement tx → Arbiscan
    link, venue: batched vs escrow).
  - **Sessions & credit (the flagship):** deposit → **sign the EIP-712 spending cap in
    the browser wallet** → watch live cap spend / headroom / pending debits from
    `GET /v1/sessions`; withdraw-after-notice flow. This makes Slice 2 — the marquee
    protocol work — actually demoable to a human.
  - **Acceptance:** a new user goes deposit → session → 10 streamed completions → sees
    the single batch settlement land, entirely in the UI, no CLI.
- **10C — Operator console + review queue · Effort M:**
  - **Node operator view** (wallet-gated to the node's own data): earnings over time,
    the **5-dimension reputation breakdown** (accuracy/uptime/latency/longevity/stake)
    with history from `reputation_snapshots`, TTFT trend, stake status, flags raised
    against the node, dispute notices + counter-evidence deadline countdown (5B's 24h
    window is unusable without a UI).
  - **Admin review queue** (admin-gated): open `node_flags` with verdict context from
    `layer_a_checks` (hashes + scores, never prompt text — privacy rule), mark-reviewed,
    and a **raise-dispute action** for confirmed cheaters. This is the UI for Slice 8's
    notification loop — if 8 hasn't landed yet, the queue endpoint is built here and 8
    only wires the paging.
  - **Acceptance:** an operator sees why their score moved without reading the DB; an
    admin goes flag → evidence → reviewed/disputed entirely in the UI.
- **10D — Network explorer (live, in-app) · Effort S:**
  - Unauthenticated route in the Vite app: live network stats, **node leaderboard**
    (composite + dimensions — also the Slice 9 leaderboard campaign artifact),
    recent-jobs ticker (job hashes + models only — privacy), **token economics panel**
    (fees collected, burned, staker pool — reads the 6A treasury; render zeros
    gracefully if 6A isn't live), gateway status indicator, the **"testnet, no real
    value" banner** on every page.
  - Live data belongs here, not in 10E — a crawler snapshot of an explorer is stale the
    moment it's taken; 10E links to it ("see the live network →").
  - **Acceptance:** a stranger with no key understands what the network is doing in 30
    seconds; the leaderboard updates as reputation snapshots land.
- **10E — Marketing & docs site (Next.js, the SEO surface) · Effort M:**
  - New `apps/website`: **Next.js, statically rendered/ISR**, deployed separately
    (Vercel or any static host/CDN) on the root domain — the gateway never serves it
    and it can never take the gateway down.
  - **Landing + SEO pages:** what QueraIS is, how it works (requester and operator
    paths), pricing/cost calculator, FAQ — the pages that should rank.
  - **Absorbs the Slice 9 docs site** (quickstart, migration guide, API reference) as
    MDX — one content property, not a third framework; Slice 9 keeps only SDK
    publishing, installers, and the growth campaign itself.
  - Headline numbers ("X jobs settled, Y QAIS burned") fetched from public read-only
    endpoints at **build/revalidate time** — no client-side gateway calls, no CORS.
  - Disclosures live here canonically (ToS, prompt-privacy incl. Layer-A sampling,
    testnet framing — the Slice 9 requirement) and the app links to them.
  - Signup CTA links into the app (`app.…/signup`) — the portal itself stays in 10B's
    Vite app where keys and wallets already work.
  - **Acceptance:** root domain serves the site statically with the app untouched;
    docs/quickstart indexed by search engines; a gateway outage leaves the site fully
    up (and vice versa).
- **Depends on:** nothing hard (10A and 10E can start any time after Stage B); 10D's
  token panel prefers 6A first; 10C's review queue coordinates with Slice 8.
- **Maps to:** P3.10 (portal) + P3.9 (operator UX + docs site) + the dashboard
  placeholder.

### Slice 11 — Arbitration completeness (STANDARD track) · Effort L · Risk H
- **Goal:** finish the last incomplete protocol mechanic. 5B shipped the FAST track
  (oracle-only `autoResolve`); contested or high-value disputes still have no path —
  the spec's STANDARD/ESCALATED tracks (`querais_smart_contracts.md` §5) are unbuilt.
- **Build (money-moving contract work → design sign-off first, standing rule):**
  - **Arbitrator registration + staking** in `NodeRegistry` or a small
    `ArbitratorPool` (stake to join, slashed for provably-wrong votes).
  - **Commit-reveal voting** on `DisputeResolution` (parallel mappings keyed by jobId —
    the spec's documented Solidity constraint), panel selection, voting deadlines with
    a default-resolution path so a silent panel can never strand a dispute (the 5B
    `reclaimBond` principle, extended).
  - **Rewards for being CORRECT** (oracle-verified after the fact), not for siding with
    the majority — the design docs are explicit on this.
  - Track routing: counter-evidence (5B) moves FAST → STANDARD; job value moves
    STANDARD → ESCALATED (larger panel).
  - **UI ships in the same slice** (10C extension: arbitrator view — assigned disputes,
    commit, reveal, outcomes). Post-Slice-10 rule: a protocol feature isn't done until
    a human can use it.
- **Acceptance:** a contested dispute (counter-evidence submitted) reaches a panel,
  commit-reveal resolves it, rewards/slashes conserve to the wei (e2e); a panel that
  never votes cannot trap the bond or the defendant's stake.
- **Maps to:** the Phase 5 arbitration deferral, pulled in deliberately.

### Slice 12 — Scale confidence (load, not architecture) · Effort M · Risk M
- **Goal:** know the ceiling before the growth push finds it for us. We deliberately
  deferred horizontal scale (P3.6); this slice buys the data that says whether that
  deferral holds.
- **Build:** a **load-test harness** (k6 or artillery + a fleet of mock nodes from the
  e2e harness) run against a staging gateway: concurrent streams, sessions/batch-flush
  under load, WS fan-in at the flood-cap boundary, SQLite write contention; capture
  ceilings as numbers in a **capacity runbook** (requests/s, concurrent streams, nodes,
  flush latency at depth). Fix the cheap wins it surfaces (backpressure, pool tuning,
  query indexes). **Decision gate at the end:** if SQLite or the single instance is the
  binding constraint at realistic load, scope the Postgres migration (the repository
  seam from Slice 1 exists for exactly this) — otherwise re-affirm the deferral with
  evidence.
- **Acceptance:** documented ceilings from real runs; alerts (Slice 8) tuned to fire
  *before* the measured cliffs; a written keep/migrate decision on SQLite with numbers
  attached.
- **Maps to:** P3.6, resolved with data instead of architecture.

### Slice 13 — Mainnet go/no-go package · Effort L · Risk H
- **Goal:** everything before real value moves. This is a **gate, not a feature** — the
  output is a decision package for the user, who makes the call (mainnet/TGE itself
  stays out of scope until then).
- **Build:** freeze the contract set; **external audit** prep + engagement (Slither
  baseline, threat model refresh, the 5B/6A conservation invariants written up as the
  audit's starting claims); an **upgrade/migration rehearsal** on testnet (the
  Transparent-Proxy story has never been exercised end-to-end); economic-parameter
  review (bond sizes, slash percentages, 60/20/20 — testnet data informs real-value
  numbers); key-custody upgrade plan (cold EOA → multisig); incident-response drill
  against the full stack; a **go/no-go checklist** with every open risk named.
- **Acceptance:** an auditor can start from the package without a walkthrough call; the
  upgrade rehearsal succeeded on testnet; the user has a one-document basis to decide
  mainnet timing.
- **Maps to:** the mainnet/TGE deferral, made into an explicit gate.

---

## Deferred for now (and why)

- **Redis / horizontal scale (P3.6)** — premature, and now also *unsafe by default*: the
  gateway's timers (flush/snapshot/sampling/patterns/disputes) assume a single owner
  (Slice 7). One gateway handles far more than current load; don't distribute pool state
  until there's load to distribute. Revisit inside Stage C only if load testing demands it.
- **Full `DisputeResolution` arbitration panel** (commit-reveal voting, panel selection) —
  only the FAST-track challenge *hook* landed (5B). **Now scheduled: Slice 11.**
- **General token-holder staking** (`StakingPool`) — only if 6B's decision goes that way;
  otherwise the staker share pays NodeRegistry stakers and a holder pool waits for the DAO.
- **Per-settlement fee splitting** (the spec's `receiveFee`) — rejected on gas grounds in
  favor of accumulate-and-sweep (Slice 6A). Revisit only if epoch-level burns ever matter.
- **Phase 4 entirely** — libp2p mesh, on-chain sealed-bid auction, decentralized oracle,
  TEE prompt privacy, DAO. Out of scope; removing the trusted gateway is the whole point
  of Phase 4 and is a separate effort. (The Phase 5 arbitration panel became Slice 11;
  mainnet/TGE became the Slice 13 gate.)

## Sequencing summary

```
Stage A (foundation)      ✅ 0 CI/Slither → ✅ 1 Persistence → ✅ 2 Batched settlement ⭐ → ✅ 3 Harden surface
Stage B (protocol depth)  ✅ 4 Reputation → ✅ 5 Layer-A verify → ⬜ 6 Tokenomics (6A treasury+burn → 6B staker rewards → 6C incentives)
Stage C (operate)         ⬜ 7 Deploy (DB-as-money) → ⬜ 8 Observability (close the review loop) → ⬜ 9 DX/public/growth
Stage D (product)         ⬜ 10 Web app (10A foundation → 10B requester → 10C operator/review → 10D live explorer · 10E Next.js site)
                          ⬜ 11 Arbitration (STANDARD track) → ⬜ 12 Scale confidence → ⬜ 13 Mainnet go/no-go gate
```

Each stage ends on the standard gate (build/typecheck/lint/unit/e2e) plus its slices'
acceptance criteria. Don't open the URL widely until Stage A is fully done; don't promote
volume until Stage B is done; Stage C is the public-launch push.

## Next step on approval

**Slice 6A — ProtocolTreasury + burn.** Money-moving contract work, so per the standing
rule it needs the user's design sign-off first. The two decisions to confirm before
building:

1. **Accumulate-and-sweep** (daily `distribute()` epoch) instead of the spec's
   per-settlement `receiveFee` split — same 60/20/20 economics, far less gas, zero hot-path
   changes. (Recommended: yes.)
2. **Who is a "staker"** for the 20% staker share (6B)? Recommended: NodeRegistry
   node stakes (Option 1) — no new contract, rewards the network's actual security. The
   6A treasury earmarks the share either way, so 6A can start once decision 1 is approved.
