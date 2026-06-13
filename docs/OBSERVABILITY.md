# QueraIS — Observability Setup (Slice 8)

How to see the gateway breathing and get paged when it stops. Three independent layers —
each works without the others, and the gateway runs fine with none configured:

| Layer | What | Needs |
|---|---|---|
| Alerts → webhook | pushes critical/warn conditions to a Discord/Slack channel | one env secret |
| `/metrics` → Prometheus/Grafana | time-series + dashboards | an ops box you run |
| `/status` | public health page, zero auth, no secrets | nothing — already live |

Runbook for every alert: **`docs/RUNBOOK_ALERTS.md`** (each alert links its own section).

---

## 1. Alerting (the paging loop)

### Discord, step by step

1. In your Discord server: create a private channel, e.g. `#querais-alerts`.
2. Channel settings → **Integrations** → **Webhooks** → **New Webhook** → name it
   (`querais-gateway`), **Copy Webhook URL**.
3. Arm the gateway (one line; the machine restarts itself with the new secrets):

   ```
   fly secrets set GATEWAY_ALERT_WEBHOOK_URL=<paste-url> GATEWAY_ALERT_WEBHOOK_FORMAT=discord -a querais-gateway
   ```

4. Verify end-to-end (fires a synthetic info alert through the real sink, bypassing
   floor + cooldown):

   ```
   curl -s -X POST -H "X-Admin-Token: $TOKEN" https://gateway.querais.xyz/v1/admin/alerts/test
   ```

   `200 {"delivered":true}` + a message in the channel = armed. `502` = the webhook is
   bad (the body carries a host-only redacted error).

**The webhook URL is a secret** — it embeds a channel token. Never commit it, never
paste it into logs/issues; the gateway itself only ever logs the host.

Slack (or Mattermost/Rocket.Chat): same flow with an incoming-webhook URL and
`GATEWAY_ALERT_WEBHOOK_FORMAT=slack`. Anything else (Telegram bot bridge, PagerDuty
events relay, your own receiver): `generic` posts the raw `Alert` JSON
(`{key, rule, severity, title, detail, runbook, at}`).

### Knobs (all optional — defaults in parentheses)

| Env | Default | Meaning |
|---|---|---|
| `GATEWAY_ALERT_WEBHOOK_URL` | unset | unset ⇒ alerting off (noop sink, one boot warning) |
| `GATEWAY_ALERT_WEBHOOK_FORMAT` | `generic` | `discord` \| `slack` \| `generic` |
| `GATEWAY_ALERT_MIN_SEVERITY` | `warn` | `info` alerts are log+metric only unless lowered |
| `GATEWAY_ALERT_COOLDOWN_SECONDS` | `3600` | per alert-key dedup window |
| `GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS` | `60` | sweep keeper cadence |
| `GATEWAY_ALERT_GAS_MIN_WEI` | `10000000000000000` (0.01 ETH) | `gas-low` floor |
| `GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS` | `900` | `stuck-debits` threshold |
| `GATEWAY_ALERT_SETTLE_FAIL_STREAK` | `3` | `settlement-failures` threshold |

Push alerts (`layer-a-anomaly`, `pattern-cheater`, `rapid-decline`) fire the moment the
flag is created — flag → channel in seconds. Sweep alerts evaluate every interval; the
per-key cooldown keeps a persisting condition to one page per hour.

---

## 2. Prometheus + Grafana

The gateway exposes hand-rendered Prometheus text at `GET /metrics` (public, read-only,
no secrets — balances are gauges, wallets are never labels). Run Prometheus anywhere
that can reach the gateway:

```
prometheus --config.file=ops/prometheus.yml
```

`ops/prometheus.yml` in this repo scrapes `gateway.querais.xyz` every 30 s — edit
the target for a different gateway. Then point Grafana at that Prometheus and import
**`ops/grafana-dashboard.json`** (Dashboards → New → Import → upload), which gives you:

- jobs settled/failed rate + per-model breakdown
- job duration & TTFT histogram quantiles (p50/p95)
- connected nodes + open review flags
- the money row: gas balance, pending debits (count/value/oldest age), faucet levels
- alert pipeline health (raised/delivered/failed/suppressed) and keeper freshness

Metric names worth knowing (all `querais_*`; full list = `curl /metrics`):

| Metric | Type | Meaning |
|---|---|---|
| `querais_jobs_settled_total{model=...}` / `_failed_total` | counter | settled (per-model labeled) / failed jobs |
| `querais_job_duration_seconds` / `querais_job_ttft_seconds` | histogram | match→settle latency / time-to-first-token |
| `querais_nodes_connected` | gauge | live WS nodes (the `querais_nodes` legacy alias was removed in Slice 9) |
| `querais_pending_debits` / `_debit_value_qais` / `querais_oldest_pending_debit_age_seconds` | gauge | the unsettled-liability ledger |
| `querais_gas_balance_wei` / `querais_hot_wallet_qais` / `querais_faucet_qais` / `querais_faucet_eth_wei` | gauge | money levels (refreshed by the alert sweep — absent until the first sweep) |
| `querais_open_flags` | gauge | unreviewed review-queue depth |
| `querais_keeper_last_success_timestamp{keeper=...}` | gauge | per-keeper freshness (flush/snapshot/patterns/treasury/alert-sweep) |
| `querais_alerts_raised_total{severity=...}` / `_delivered_total` / `_failed_total` / `_suppressed_total` | counter | the paging loop watching itself |

Useful PromQL starters:

```promql
rate(querais_jobs_settled_total[5m])                                   # throughput
histogram_quantile(0.95, rate(querais_job_ttft_seconds_bucket[15m]))   # p95 TTFT
time() - (querais_keeper_last_success_timestamp / 1000)                # keeper staleness (s)
querais_alerts_failed_total                                            # dead webhook detector
```

---

## 3. The status page

- **`GET /status`** — human page (auto-refreshing): green/yellow/red + nodes, RPC, jobs
  24h, last settlement age, uptime, open incidents.
- **`GET /v1/status`** — the same as JSON, 5 s server-side cache (safe to poll; an
  external uptime checker can't become an RPC amplifier).

`degraded` = RPC unreachable, or 0 nodes connected while the last 24 h saw jobs. The
public surface intentionally exposes **no balances, no wallets, no flag details** —
those live behind `/metrics` (numbers only) and the admin API.

---

## 4. Where logs live

Structured Pino JSON to stdout → read it where the host streams stdout (the self-hosted
box's process/journal logs; `fly logs -a querais-gateway` if you run it on Fly). Every
alert is also a `logger.warn` (`ALERT: <title>`) with rule/key/severity fields, so the log
stream is the fallback channel when no webhook is configured. For retention beyond the
host's buffer, ship stdout to your aggregator of choice (stdout → vector/loki is the
no-frills path); nothing in the gateway needs to change.
