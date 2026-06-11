# Slice 8 — Observability & SRE: the full plan

> Standalone, complete plan for Slice 8. Supersedes (and expands) the Slice 8 entry in
> `docs/EXECUTION_PLAN.md`. Written 2026-06-11, against main @ `ab9cba7` (Slice 7 merged,
> gateway LIVE at `querais-gateway.fly.dev`, Stage-B contract set live on Arbitrum Sepolia).

---

## 1. Context — why this slice exists

The protocol now computes every signal that matters and **tells no one**:

| Signal | Where it's computed | What happens today |
|---|---|---|
| Layer-A semantic anomaly (similarity < 0.70) | `oracle/layer-a.ts:136-167` | `node_flags` row + `metrics.layerAAnomalies++` + a `logger.warn` nobody reads |
| Pattern cheater (duplicate output / truncation) | `oracle/patterns.ts:62-117` | `node_flags` row + `metrics.patternFlags++` + warn log |
| Rapid reputation decline (>20% in 7d) | `reputation.ts` (`RAPID_DECLINE_DROP_BPS=2000`) | `flagged=1` snapshot column + `metrics.reputationFlags++` + warn log |
| Settlement failure | `settlement.ts` / `batched-settlement.ts` | error log, `jobsFailed++` |
| Stuck pending debits (nodes silently unpaid) | nowhere — **not even computed** | nothing |
| Gas wallet running dry | nowhere | discovered when txs start failing |

A flagged cheater **keeps serving jobs** until someone happens to read Fly logs. The
gateway DB is money (pending-debit ledger = unsettled liability owed to nodes); the hot
wallet pays for every on-chain write. Both can fail silently today.

**Slice 8 closes the loop: signal → alert → human, with a runbook attached.** Plus the
metrics/dashboard surface to see the system breathing, and a public status page.

Design constraint carried from the execution plan: **no new infra**. The gateway already
has Pino structured logs, a `/metrics` Prometheus endpoint, a SQLite DB, an admin-token
auth pattern, and an error-isolated `setInterval` keeper pattern (`server.ts:237-304`).
Slice 8 composes these; it does not introduce a message queue, an email server, or a
hosted monitoring stack. The one external touchpoint is an **outbound webhook** (Discord/
Slack/Telegram/generic), which is a single `fetch`.

---

## 2. Scope

### In scope
- **8A — The paging loop** (highest value, ships first):
  - `AlertService` with a pluggable sink seam (webhook + noop), severity levels,
    per-alert-key cooldown, and delivery metrics.
  - **Push alerts** at the moment of flag creation (Layer-A anomaly, pattern cheater,
    rapid decline) — not just on a sweep. Acceptance demands flag → human < 5 min;
    push makes it < 5 s.
  - **Sweep alerts** (a new keeper timer) for threshold rules: gas balance, oldest
    unflushed debit age, settlement failure streak, node-count drop, faucet balances.
  - **Review queue**: `node_flags` gains `reviewed_at`/`reviewed_by`; admin endpoints to
    list open flags and mark reviewed; open-flag gauge in `/metrics`.
  - **Runbooks**: `docs/RUNBOOK_ALERTS.md` — one section per alert id, copy-pasteable
    2am steps. An alert without a runbook section does not ship (CI-checkable: alert ids
    in code must appear in the runbook).
- **8B — Seeing the system**:
  - `/metrics` enrichment: latency histogram (job duration + TTFT), per-model job/token
    counters, gauges (oldest-debit age, pending-debit count+value, gas/QAIS balances,
    open flags, connected nodes, last-keeper-success timestamps).
  - **Public status page** at `/status` (HTML, zero-auth, no secrets): gateway up,
    RPC ok, nodes online, jobs last 24 h, last settlement age. Backed by `GET /v1/status`
    JSON (public, rate-limited, cached for 5s).
  - **Ops examples** (not deployed infra): `ops/prometheus.yml` scrape config +
    `ops/grafana-dashboard.json` starter dashboard, documented in `docs/OBSERVABILITY.md`.

### Out of scope (deliberately)
- Hosted Prometheus/Grafana/log aggregation (operator brings their own; examples given).
- Auto-slash / auto-deregister on flags — review stays human (protocol design decision).
- Email/SMS providers needing accounts+keys (webhook covers Discord/Slack/Telegram).
- Horizontal scale / multi-instance concerns (P3.6, single-writer rule unchanged).
- Node-daemon-side observability (this slice is the gateway; daemon has its dashboard).

---

## 3. Architecture

### 3.1 The alert seam

```
                     ┌────────────────────────────────────────────┐
 push (instant)      │            AlertService                    │
 layer-a.ts ────────►│  raise(alert: Alert)                       │
 patterns.ts ───────►│   • severity: 'info'|'warn'|'critical'     │     ┌──────────────┐
 reputation.ts ─────►│   • dedup: cooldown per alert.key          │────►│  AlertSink   │
                     │   • metrics: alertsRaised/Delivered/Failed │     │  (seam)      │
 sweep (interval)    │   • never throws into callers              │     ├──────────────┤
 alert-rules.ts ────►│                                            │     │ WebhookSink  │
  (new keeper timer) └────────────────────────────────────────────┘     │ NoopSink     │
                                                                        │ (tests: Mem) │
                                                                        └──────────────┘
```

**`Alert`** (new `packages/gateway/src/alerts.ts`):
```ts
export interface Alert {
  key: string;        // stable id for dedup/cooldown, e.g. 'layer-a-anomaly:0xwallet'
  rule: string;       // rule id, e.g. 'layer-a-anomaly' — must match a runbook anchor
  severity: 'info' | 'warn' | 'critical';
  title: string;      // one line, human
  detail: string;     // what + numbers
  runbook: string;    // absolute URL into docs/RUNBOOK_ALERTS.md#<rule>
  at: number;         // epoch ms
}

export interface AlertSink {
  deliver(alert: Alert): Promise<void>;  // throws on failure; service catches + counts
}
```

**`AlertService`** behavior:
- `raise()` is **fire-and-forget** from the caller's perspective (same discipline as
  Layer-A sampling: a dead webhook must never break settlement).
- **Cooldown**: identical `alert.key` is suppressed for `GATEWAY_ALERT_COOLDOWN_SECONDS`
  (default 3600). In-memory map — restart resets, acceptable: worst case one duplicate
  page after a deploy. Suppressed alerts still increment `alertsSuppressed`.
- **Severity floor**: `GATEWAY_ALERT_MIN_SEVERITY` (default `warn`) — `info` alerts are
  metric+log only unless opted in.
- Delivery failure: `logger.error` + `metrics.alertsFailed++`. **No retry queue** (no new
  infra; the next sweep/occurrence re-raises after cooldown).

**`WebhookSink`**: one `fetch(POST)` with 5 s timeout.
`GATEWAY_ALERT_WEBHOOK_FORMAT` selects the body shape:
- `discord` → `{ content: "🔴 **title**\ndetail\n<runbook>" }`
- `slack`   → `{ text: "..." }` (also works for Mattermost/Rocket.Chat)
- `generic` → the raw `Alert` JSON (Telegram bots, custom receivers, PagerDuty bridges)

No URL configured → `NoopSink` + a single startup `logger.warn`
(`'alerting disabled — GATEWAY_ALERT_WEBHOOK_URL not set'`). The gateway must run fine
without alerting configured (dev, e2e default).

### 3.2 Push alerts (flag-time)

`NodeFlagStore.add()` stays pure (DB write). The **callers** raise the alert — they have
the context (jobId, similarity, kind). Three call sites:

| Site | Alert rule | Severity |
|---|---|---|
| `oracle/layer-a.ts` anomaly branch | `layer-a-anomaly` | critical |
| `oracle/patterns.ts` flag branch | `pattern-cheater` | critical |
| `reputation.ts` rapid-decline branch | `rapid-decline` | warn |

`AlertService` is injected through `GatewayDeps` (`deps.ts`) like every other service, so
tests inject a `MemorySink` and assert on captured alerts.

### 3.3 Sweep alerts (the new keeper)

New module `packages/gateway/src/alert-rules.ts` — pure rule functions over injected
reads, plus one keeper registration in `server.ts` following the exact existing pattern
(`setInterval` + `.unref()` + error isolation + `clearInterval` in `onClose`).
Interval: `GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS` (default 60).

**Rule catalogue v1** (each row = one runbook section; thresholds env-overridable):

| Rule id | Condition (default) | Severity | Why it's money-shaped |
|---|---|---|---|
| `gas-low` | hot wallet ETH < `GATEWAY_ALERT_GAS_MIN_WEI` (0.01 ETH) | critical | every settle/snapshot/keeper tx fails without gas |
| `stuck-debits` | oldest unflushed debit age > `GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS` (900) | critical | settlement stuck = nodes silently unpaid |
| `settlement-failures` | ≥ `GATEWAY_ALERT_SETTLE_FAIL_STREAK` (3) consecutive flush failures | critical | liability accumulating, possible chain/RPC issue |
| `node-drop` | connected nodes fell ≥ 50% from the max seen in the last hour (and max ≥ 2) | warn | capacity loss / network event |
| `open-flags` | unreviewed `node_flags` count > 0, re-raised at most once per cooldown | warn | the review queue is non-empty — go look |
| `faucet-low` | faucet key set AND (QAIS < 10× claim OR ETH < 10× claim) | warn | onboarding silently broken |
| `keeper-stale` | any keeper (snapshot/treasury/rewards) last success > 2× its interval ago | warn | a daily timer died silently |
| `rpc-degraded` | `/ready`-style RPC probe failed ≥ 3 consecutive sweeps | critical | everything chain-touching is down |

Implementation notes:
- **`stuck-debits`** needs `batched-settlement.ts` to expose
  `oldestPendingDebitAt(): number | undefined` (it owns the pending ledger) — also
  exported as a `/metrics` gauge.
- **`settlement-failures`** — `credit.flushAll()` already logs failures; add a
  consecutive-failure counter readable by the rule (reset on success).
- **`keeper-stale`** — each existing keeper records `lastSuccessAt` into a shared
  `KeeperHealth` map (tiny addition at each timer's success path).
- **`node-drop`** — `node-pool.ts` already knows connected count; rule keeps an
  in-memory high-water mark with hourly decay.
- Balance reads (`gas-low`, `faucet-low`) go through `chain-client.ts`; the sweep must
  tolerate RPC failure (that's `rpc-degraded`'s job, not a crash).

### 3.4 Review queue

**Migration 7** (`db/migrations.ts`):
```sql
ALTER TABLE node_flags ADD COLUMN reviewed_at INTEGER;  -- NULL = open
ALTER TABLE node_flags ADD COLUMN reviewed_by TEXT;     -- free text, e.g. 'shavit'
ALTER TABLE node_flags ADD COLUMN review_note TEXT;
CREATE INDEX idx_node_flags_open ON node_flags(reviewed_at) WHERE reviewed_at IS NULL;
```

`NodeFlagStore` additions: `openFlags(limit, offset)`, `openCount()`,
`markReviewed(id, by, note)`, `get(id)`.

**Admin endpoints** (new `routes/flags.ts`, `X-Admin-Token` auth — same guard as
`routes/keys.ts:12-14`):
- `GET  /v1/admin/flags?status=open|all&wallet=0x..&limit=50&offset=0`
  → `{ flags: [{id, wallet, kind, detail, createdAt, reviewedAt, reviewedBy, reviewNote}], openCount }`
- `POST /v1/admin/flags/:id/review` body `{ by: string, note?: string }`
  → 200 with the updated flag; 404 unknown id; 409 already reviewed.
- `GET /v1/nodes` keeps exposing `flags` count — change it to **open** flags count
  (reviewed flags stop scaring requesters; history stays queryable via admin route).

### 3.5 Metrics enrichment (`metrics.ts`)

Keep the zero-dependency hand-rendered Prometheus format (it works and is tested by
scrape in CI); extend it:

- **Histogram** `querais_job_duration_seconds` (+ `_ttft_seconds` if dispatcher exposes
  first-token timestamps — it records both on settle): fixed buckets
  `[0.5, 1, 2.5, 5, 10, 30, 60, 120]`, rendered as standard `_bucket/_sum/_count`.
- **Per-model counters**: `querais_jobs_settled_total{model="..."}`,
  `querais_tokens_served_total{model="..."}` — label values come from the model registry
  (bounded set, no cardinality explosion).
- **Gauges**:
  - `querais_pending_debits` / `querais_pending_debit_value_qais` / `querais_oldest_pending_debit_age_seconds`
  - `querais_gas_balance_wei` / `querais_hot_wallet_qais` / `querais_faucet_qais` / `querais_faucet_eth_wei` (refreshed by the alert sweep — no extra RPC traffic)
  - `querais_open_flags`
  - `querais_nodes_connected` (exists as a render-time value; formalize)
  - `querais_keeper_last_success_timestamp{keeper="snapshot|treasury|rewards|flush"}`
  - `querais_alerts_raised_total{severity}` / `_delivered_total` / `_failed_total` / `_suppressed_total`
- Naming: migrate to `querais_*` prefix with `# HELP/# TYPE` lines; keep old names
  emitting for one slice (comment in code: remove in Slice 9) so nothing scraping today
  breaks.

### 3.6 Status page

- `GET /v1/status` (public, rate-limited, 5 s in-process cache):
  ```json
  { "status": "ok|degraded|down", "nodes": 3, "rpcOk": true,
    "jobs24h": 124, "lastSettlementAgeSeconds": 41, "uptimeSeconds": 86400,
    "openIncidents": 0 }
  ```
  `degraded` = RPC down or 0 nodes while jobs exist; computed, not stored. **No
  balances, no wallets, no flag details** on the public surface.
- `GET /status` — small static HTML (same inline-HTML pattern as the `/` dashboard,
  `server.ts`), polls `/v1/status` every 10 s, shows green/yellow/red + the numbers.

### 3.7 Runbooks & ops docs

- **`docs/RUNBOOK_ALERTS.md`** — one `## <rule-id>` section per rule: what fired, what
  it means, copy-pasteable diagnosis commands (Fly logs, `/metrics` greps, `split-admin
  status`, `pnpm ops:pause` reference), resolution steps, escalation (when to pause).
  The `runbook` URL in each `Alert` points here. **CI guard**: a unit test asserts every
  rule id in `alert-rules.ts` + the three push rules has a matching `## ` heading
  (read the md file from the test — no infra).
- **`docs/OBSERVABILITY.md`** — how to point Prometheus at `/metrics` (`ops/prometheus.yml`),
  import `ops/grafana-dashboard.json`, configure the webhook (Discord step-by-step:
  channel → integrations → webhook URL → `fly secrets set`), and test it
  (`POST /v1/admin/alerts/test`).
- `POST /v1/admin/alerts/test` (admin-token) — fires a synthetic `info` alert through the
  real sink so operators can verify the channel end-to-end. This is also the live-drill
  step in acceptance.

### 3.8 New env vars (all parsed in `config.ts`, following `layerAFromEnv` pattern)

| Var | Default | Notes |
|---|---|---|
| `GATEWAY_ALERT_WEBHOOK_URL` | unset | unset → alerting off (noop sink) |
| `GATEWAY_ALERT_WEBHOOK_FORMAT` | `generic` | `discord` \| `slack` \| `generic` |
| `GATEWAY_ALERT_MIN_SEVERITY` | `warn` | `info` floor for chatty channels |
| `GATEWAY_ALERT_COOLDOWN_SECONDS` | `3600` | per alert.key |
| `GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS` | `60` | the keeper cadence |
| `GATEWAY_ALERT_GAS_MIN_WEI` | `10^16` (0.01 ETH) | `gas-low` threshold |
| `GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS` | `900` | `stuck-debits` threshold |
| `GATEWAY_ALERT_SETTLE_FAIL_STREAK` | `3` | `settlement-failures` threshold |

---

## 4. Work breakdown (one branch, one PR, commits in this order)

1. **`alerts.ts`** — `Alert`, `AlertSink`, `AlertService` (cooldown, severity floor,
   metrics), `WebhookSink` (3 formats), `NoopSink`, `MemorySink` (test export).
   Unit tests: cooldown, severity floor, format bodies, failure counting, never-throws.
2. **`config.ts`** — `alertsFromEnv()` + wire into `GatewayConfig`. Unit tests.
3. **`deps.ts` / `server.ts`** — construct sink from config, inject `AlertService` into
   deps; startup log line stating alerting on/off + format.
4. **Push alerts** — 3 call sites (`layer-a.ts`, `patterns.ts`, `reputation.ts`).
   Extend their existing unit tests with a `MemorySink` assertion each.
5. **Migration 7 + `NodeFlagStore` extensions** (`openFlags/openCount/markReviewed/get`).
   Unit tests incl. migration-on-existing-db (pattern from `db/jobs.test.ts`).
6. **`routes/flags.ts`** + register in `server.ts`; switch `/v1/nodes` to open-count.
   Route tests (auth 401, list, filter, review, 404/409).
7. **Keeper health + settlement instrumentation** — `KeeperHealth` map,
   `oldestPendingDebitAt()`, consecutive-failure counter. Unit tests in
   `batched-settlement.test.ts` / `settlement.test.ts`.
8. **`alert-rules.ts`** + sweep keeper in `server.ts`. Pure-function unit tests per rule
   (inject fake reads — no RPC in unit tests).
9. **`metrics.ts` enrichment** — histogram, per-model labels, gauges, `querais_*`
   naming + legacy passthrough. Unit test: render snapshot parses as Prometheus text
   (simple line-format assertions, no dep).
10. **Status page** — `/v1/status` + `/status` HTML + 5 s cache. Route tests.
11. **`/v1/admin/alerts/test`** endpoint. Route test.
12. **Docs**: `docs/RUNBOOK_ALERTS.md` (all 11 rule sections), `docs/OBSERVABILITY.md`,
    `ops/prometheus.yml`, `ops/grafana-dashboard.json`; runbook-coverage unit test;
    update `HANDOFF.md` + `docs/EXECUTION_PLAN.md` (mark 8 ◐→✅ on merge).
13. **e2e scenario 17 (Slice 8)** in `packages/test-e2e/src/e2e.ts`:
    - harness boots gateway with `GATEWAY_ALERT_WEBHOOK_URL` → an in-harness HTTP
      listener (the "human channel"), generic format, cooldown 1 s, sweep 1 s,
      debit-max-age 2 s.
    - induce a Layer-A anomaly (mock oracle, as scenario 11) → assert the webhook
      receives `layer-a-anomaly` (closes the acceptance: flag → channel < 5 min).
    - `GET /v1/admin/flags` shows it open → `POST .../review` → open count 0 →
      `/v1/nodes` flag count back to 0.
    - hold a pending debit past 2 s (pause flush via tiny threshold config) → assert
      `stuck-debits` arrives; release; assert recovery.
    - `GET /v1/status` returns `ok` with live numbers; `/metrics` contains
      `querais_oldest_pending_debit_age_seconds` and the histogram.

Estimated diff: ~1,800 LOC incl. tests/docs. Effort M. Risk M (no chain changes, no
schema-destructive migration; the only outbound surface is one webhook fetch).

---

## 5. Acceptance criteria (from EXECUTION_PLAN, made concrete)

- [ ] An induced Layer-A flag reaches the configured webhook channel — e2e proves < 5 s,
      live drill (`/v1/admin/alerts/test` + a real induced flag on Sepolia) proves the
      production path.
- [ ] Simulated **gas-low**, **node-drop**, and **stuck-debit** conditions each fire
      exactly one alert (then respect cooldown) — unit + e2e.
- [ ] Review queue: open flags listable and markable via admin API; `/v1/nodes` shows
      open count; `querais_open_flags` gauge tracks it.
- [ ] `/metrics` exposes the money gauges (oldest-debit age, gas, faucet, pending value),
      latency histogram, per-model counters — verified by CI scrape-parse test.
- [ ] Public `/status` page reflects an induced outage (`degraded` on RPC-down in e2e).
- [ ] Every alert rule id has a matching runbook section — enforced by a unit test.
- [ ] Full green bar: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`.
- [ ] No regression: gateway boots with **zero** new env vars set (alerting off, status
      page up, all keepers unchanged).

## 6. Rollout (after merge — operator steps, kept out of the PR)

1. Create a Discord (or Slack) webhook for a private `#querais-alerts` channel.
2. `fly secrets set GATEWAY_ALERT_WEBHOOK_URL=... GATEWAY_ALERT_WEBHOOK_FORMAT=discord --app querais-gateway`
   (single line, cmd.exe-safe) → machine restarts with alerting armed.
3. `curl -X POST -H "X-Admin-Token: ..." https://querais-gateway.fly.dev/v1/admin/alerts/test`
   → message lands in the channel. Append the drill to `RUNBOOK_KEYS.md` §6 log.
4. Point an ops-box Prometheus at `https://querais-gateway.fly.dev/metrics` using
   `ops/prometheus.yml`; import the Grafana dashboard. (Optional, any time.)
5. Watch `open-flags` — the queue is now paged, so keep it at zero.

## 7. Risks & mitigations

- **Webhook secret leakage in logs** — never log the URL; config logger redacts it
  (log `host` only). Test asserts redaction.
- **Alert storms** (e.g. RPC flap → every rule fires) — cooldown per key + `rpc-degraded`
  raised only after 3 consecutive failed sweeps + sweep skips balance rules while RPC is
  down (one cause, one page).
- **Blocking the hot path** — `raise()` is fire-and-forget with a 5 s fetch timeout;
  push call sites are already inside fire-and-forget contexts (Layer-A sampler pattern).
- **Cardinality** — model labels only from the registry's bounded model list; wallet
  addresses NEVER become metric labels (flags are counted, not labeled).
- **SQLite migration on live volume** — additive `ALTER TABLE ... ADD COLUMN` only;
  migration 7 is idempotent-guarded like 1–6; tested against a copy of a populated DB.
