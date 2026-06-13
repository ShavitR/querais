# QueraIS — Alert Runbook

Every alert the gateway raises links here with an anchor equal to its **rule id**
(`https://github.com/ShavitR/querais/blob/main/docs/RUNBOOK_ALERTS.md#<rule-id>`).
A unit test (`gateway/src/runbook-coverage.test.ts`) enforces that every rule id in the
code has a `## <rule-id>` section in this file — **an alert without a runbook does not
ship**. If you add a rule, add its section here in the same PR.

Conventions used below:

- **Live gateway:** self-hosted on the operator's box at `https://gateway.querais.xyz`,
  exposed via a free Cloudflare Tunnel (Fly was retired when its trial ended). Read logs
  where that box streams stdout. The `fly logs -a querais-gateway` / `fly machine restart`
  commands below apply only if you run the gateway on Fly (still a supported hosting
  option — see `docs/DEPLOY.md`); on the self-hosted box, use the host's equivalents.
- **Metrics:** `curl -s https://gateway.querais.xyz/metrics | grep <name>`.
- **Admin calls** need `-H "X-Admin-Token: <token>"` (the token is a host env secret).
- **Cold-key actions** (pause, role changes, ops allocations) run from the maintainer's
  machine only — see `RUNBOOK_KEYS.md`. Hot keys live in host env secrets, cold keys never do.
- Alert cadence: each alert key re-fires at most once per cooldown
  (`GATEWAY_ALERT_COOLDOWN_SECONDS`, default 1h). Silence after one page does NOT mean
  recovery — check the metric.

Severity meanings: **critical** = money or the whole service is at risk, act now;
**warn** = degraded/queue building, act this business day; **info** = FYI (below the
default severity floor — log + metric only unless `GATEWAY_ALERT_MIN_SEVERITY=info`).

---

## gas-low

**Fired when:** the gateway hot wallet's ETH balance < `GATEWAY_ALERT_GAS_MIN_WEI`
(default 0.01 ETH). **Critical** — every settle / snapshot / treasury / dispute tx fails
without gas, which cascades into `settlement-failures` and `stuck-debits`.

1. Confirm the number:
   ```
   curl -s https://gateway.querais.xyz/metrics | grep querais_gas_balance_wei
   ```
2. Top up the HOT gateway wallet (`0xc80A...b9d6` — verify against
   `packages/contracts/deployments/addresses.arbitrumSepolia.json` `gateway` field) with
   Arbitrum Sepolia ETH. Testnet: any Sepolia faucet + the official Arbitrum bridge, or
   transfer from the cold admin wallet (cold key stays on the maintainer's machine).
3. Watch the gauge recover on the next sweep (≤ `GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS`,
   default 60 s). No restart needed.
4. If settlement failures accumulated while dry, see [settlement-failures](#settlement-failures)
   — the flush retries automatically; verify `querais_pending_debits` drains to 0.

**Escalate:** if the wallet drains repeatedly faster than expected, something is burning
gas (runaway keeper, griefing). Check `fly logs` for tx spam; consider `pnpm ops:pause`
(see `RUNBOOK_KEYS.md` §8) while investigating.

## stuck-debits

**Fired when:** the oldest unflushed debit is older than
`GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS` (default 900 s). **Critical** — the off-chain
ledger is money owed to providers; stuck means **nodes are silently unpaid**.

1. Size the problem:
   ```
   curl -s https://gateway.querais.xyz/metrics | grep -E "querais_(pending_debits|pending_debit_value_qais|oldest_pending_debit_age_seconds)"
   ```
2. Find why the flush isn't landing — the usual suspects, in order:
   - **Gas**: `querais_gas_balance_wei` low → fix [gas-low](#gas-low) first.
   - **RPC**: `querais_alerts` for `rpc-degraded`, or `/ready` returning 503 → see
     [rpc-degraded](#rpc-degraded).
   - **Flush errors**: `fly logs -a querais-gateway | grep -i "flush"` — look for revert
     reasons (`CapExpired`, insufficient deposit) from `batchSettle`.
3. Do nothing rash: debits are durable (SQLite) and the flush retries on the interval
   timer, on threshold, and on shutdown. The 2C reconcile-on-revert machinery unsticks
   debits already settled on-chain. Once the cause is fixed, the age gauge drops on its
   own.
4. If a specific requester's cap expired (`CapExpired` in logs), their pending debits
   cannot settle against that cap. This is the known no-margin edge — the deadline-margin
   guard should prevent it; if it happened anyway, record the jobIds from the log and
   raise with the maintainer (provider compensation comes from the ops allocation,
   `pnpm ops:allocate`).

**Escalate:** age keeps climbing past 2× threshold with gas + RPC healthy → restart the
machine (`fly machine restart -a querais-gateway`); the boot path re-arms the flush. If
it persists after restart, pause intake (`pnpm ops:pause`) and debug with the DB snapshot.

## settlement-failures

**Fired when:** ≥ `GATEWAY_ALERT_SETTLE_FAIL_STREAK` (default 3) **consecutive**
`batchSettle` flush attempts threw. **Critical** — liability accumulates while flushes
fail; almost always shares a cause with [stuck-debits](#stuck-debits).

1. Read the actual errors:
   ```
   fly logs -a querais-gateway | grep -iE "flush|batchSettle|settle"
   ```
2. Triage by error class:
   - RPC/network errors → [rpc-degraded](#rpc-degraded).
   - `insufficient funds` → [gas-low](#gas-low).
   - Contract reverts (`CapExpired`, cap exceeded) → the reconcile path stamps
     already-settled jobs; remaining debits need the requester's session state —
     check `GET /v1/sessions` semantics and the 2C notes in `HANDOFF.md`.
3. The streak resets on the first successful flush — watch the alert stop re-firing and
   `querais_pending_debits` drain.

**Escalate:** same as stuck-debits — restart, then pause if it survives a restart.

## node-drop

**Fired when:** connected nodes fell to ≤ 50% of the highest count seen in the last hour
(only when that high was ≥ 2). **Warn** — capacity loss or a network event.

1. Current count: `curl -s https://gateway.querais.xyz/metrics | grep querais_nodes_connected`.
2. `fly logs -a querais-gateway | grep -iE "ws|disconnect|socket"` — mass disconnects at
   one timestamp point at the gateway (deploy? machine restart? WS cap?); scattered ones
   point at the nodes.
3. If the gateway just deployed/restarted, nodes auto-reconnect (daemon has reconnect
   logic) — give it 2 minutes before digging.
4. If one operator's nodes all dropped, it's their box/network; reputation uptime scoring
   handles the incentives — nothing for you to do.

**Escalate:** count stays at 0 with requests arriving (status page goes `degraded`) —
treat as an outage; check the WS endpoint specifically (`/node` upgrade path) and recent
config changes to the WS caps (`GATEWAY_WS_*`).

## open-flags

**Fired when:** the review queue is non-empty (any unreviewed `node_flags` row).
**Warn** — Slices 4/5 route cheating signals to manual review; this alert exists so the
queue can never silently rot. Re-raised at most once per cooldown while > 0.

1. List the queue:
   ```
   curl -s -H "X-Admin-Token: $TOKEN" "https://gateway.querais.xyz/v1/admin/flags?status=open"
   ```
2. Judge each flag by kind — see [layer-a-anomaly](#layer-a-anomaly),
   [pattern-cheater](#pattern-cheater), [rapid-decline](#rapid-decline) below for what
   each kind means and the evidence to check.
3. Mark it handled (verdict goes in the note — flags are append-only history):
   ```
   curl -s -X POST -H "X-Admin-Token: $TOKEN" -H "Content-Type: application/json" \
     -d '{"by":"shavit","note":"<verdict>"}' \
     https://gateway.querais.xyz/v1/admin/flags/<id>/review
   ```
4. `querais_open_flags` returns to 0; `/v1/nodes` stops showing the flag count to
   requesters.

**Escalate:** never auto-slash from a flag (protocol rule). A confirmed cheater warrants
an on-chain dispute (`GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY`, or a manual
`raiseDispute`) — maintainer decision.

## faucet-low

**Fired when:** the faucet wallet holds < 10 claims' worth of QAIS, or (when ETH grants
are enabled) < 10 claims of ETH. **Warn** — onboarding silently breaks when the well
runs dry (the balance guard refuses claims cleanly, but new nodes can't join).

1. Confirm:
   ```
   curl -s https://gateway.querais.xyz/metrics | grep -E "querais_faucet_(qais|eth_wei)"
   ```
2. Top up the faucet wallet (address in the Fly secrets / `.env` faucet config) with
   testnet QAIS (transfer from treasury ops via `pnpm ops:allocate`, or mint-era supply
   from the deployer) and Sepolia ETH.
3. The gauge refreshes on the next sweep. Claims resume automatically — refused claims
   did NOT burn the address's one-claim allowance (balance-guard design).

**Escalate:** if it drains abnormally fast, someone may be Sybil-farming past the per-IP
throttle — check `fly logs | grep faucet` for claim patterns and consider lowering
`GATEWAY_FAUCET_DAILY_CAP`.

## keeper-stale

**Fired when:** a registered keeper timer (flush / snapshot / patterns / treasury /
alert-sweep) hasn't recorded a success for > 2× its interval. **Warn** — a daily timer
dying silently is exactly the failure mode this catches. One alert per keeper name.

1. Which keeper and how stale is in the alert detail; cross-check:
   ```
   curl -s https://gateway.querais.xyz/metrics | grep querais_keeper_last_success_timestamp
   ```
2. `fly logs -a querais-gateway | grep -i "<keeper name>"` — keepers are error-isolated,
   so the tick fires but its work throws; the log has the actual error.
3. Map keeper → cause:
   - `flush` → settlement path: see [settlement-failures](#settlement-failures).
   - `snapshot` (reputation) / `treasury` → chain writes: gas or RPC, usually.
   - `patterns` → pure SQLite sweep; a failure here is a bug — capture the log line.
   - `alert-sweep` → ironic but possible (the sweep itself never throws by design; a
     stale alert-sweep means the interval timer died) — restart.
4. A machine restart re-arms every timer: `fly machine restart -a querais-gateway`.

**Escalate:** if a keeper goes stale repeatedly with healthy gas/RPC, open an issue with
the log extract — that's a code bug, not ops.

## rpc-degraded

**Fired when:** the sweep's RPC probe (a block read) failed ≥ 3 consecutive sweeps.
**Critical** — everything chain-touching (settlement, snapshots, treasury, disputes,
faucet) is down. The sweep deliberately skips balance rules while RPC is down (one
cause, one page).

1. Confirm independently from your machine:
   ```
   curl -s https://gateway.querais.xyz/ready          # 503 = gateway agrees
   curl -s -X POST https://sepolia-rollup.arbitrum.io/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
   ```
2. If the public probe works but the gateway's doesn't → egress problem on the Fly
   machine or a stale/rate-limited RPC URL in secrets. Check `fly logs` for the provider
   error; rotate `ARBITRUM_SEPOLIA_RPC_URL` to another provider if rate-limited.
3. If the chain/provider is down for everyone → wait it out. The gateway degrades
   safely: API intake keeps serving from sessions (batched venue), debits queue durably,
   `/v1/status` shows `degraded`. Expect [stuck-debits](#stuck-debits) to follow if the
   outage outlasts the debit-age threshold — same cause, no extra action.
4. Recovery is automatic: probe succeeds → streak resets → flush retries → gauges refresh.

**Escalate:** multi-hour provider outage → switch RPC provider via
`fly secrets set ARBITRUM_SEPOLIA_RPC_URL=... -a querais-gateway` (machine restarts
itself with the new secret).

## layer-a-anomaly

**Fired when:** Layer-A sampling re-ran a settled job on oracle inference and the best
similarity across oracle runs came back < 0.70 — the provider's output is semantically
unrelated to what the prompt should produce. **Critical** push alert (fires at flag
time, not on a sweep). The node's accuracy EMA already took the α=0.05 hit; a
manual-review flag is open.

1. Pull the flag (id is in the alert detail):
   ```
   curl -s -H "X-Admin-Token: $TOKEN" "https://gateway.querais.xyz/v1/admin/flags?status=open&wallet=<wallet>"
   ```
   Detail carries jobId + similarity. Prompts/outputs are NEVER persisted (privacy
   rule) — the DB has verdicts + hashes only.
2. Judge: one anomaly can be an unlucky sample (weird prompt, model quirk). Look at the
   node's history — repeated anomalies, or anomaly + [pattern-cheater](#pattern-cheater)
   on the same wallet, is a cheater; a single hit on a long-good node probably isn't.
3. Honest-looking blip → review the flag with a note; the EMA recovers on passing jobs.
4. Cheater → review the flag with the verdict, then maintainer decides the on-chain
   dispute (50-QAIS bond, 20%-of-stake slash on win — `DisputeResolution`). Never
   auto-slash from the flag itself.

**Escalate:** several DIFFERENT nodes anomalous at once usually means the ORACLE side is
broken (Ollama model changed/unloaded, embedding model mismatch) — check
`GATEWAY_ORACLE_OLLAMA_URL` health before accusing anyone.

## pattern-cheater

**Fired when:** the hourly pattern sweep found a cheating shape in settled job rows:
the same output hash across ≥ 3 distinct prompts (caching cheater — distinct jobId ⇒
distinct prompt), or (near-)always-`length` truncation over ≥ 10 jobs (token-padding).
**Critical** push alert; one open flag per ongoing pattern (no re-flag spam).

1. The flag detail names the pattern + the hash/ratio. List it via the admin flags API
   (as above, filter by wallet).
2. Duplicate-output is close to a smoking gun — identical bytes for different prompts
   has no honest explanation at scale. Truncation is softer: a node with a tight context
   window or aggressive `max_tokens` clipping can look similar; check whether its
   truncation ratio is ~1.0 across MANY models/prompts (cheater) or clustered on long
   prompts (config).
3. Confirmed → review-with-verdict, then dispute/deregistration is the maintainer's
   call. The node keeps serving while flagged (by design — review, not eviction);
   matching reputation pressure already deprioritizes it via the EMA hits.

**Escalate:** the same wallet re-flagged after a reviewed pattern means the pattern
RESUMED (sweep only re-flags ongoing behavior) — skip the benefit of the doubt.

## rapid-decline

**Fired when:** a node's composite reputation dropped > 2000 bps (20 points) within a
7-day window. **Warn** push alert from the snapshot sweep. No chain effect — the flag
exists because a sudden fall is either a failing node (hardware/model rot) or the EMA
catching a new cheater mid-fall.

1. The alert detail has the wallet + before/after composites. Pull its dimensions:
   ```
   curl -s https://gateway.querais.xyz/v1/nodes | jq '.nodes[] | select(.wallet=="<wallet>")'
   ```
2. Read the falling dimension:
   - Accuracy falling → Layer-B failures or Layer-A hits — check the wallet's flags;
     likely company for [layer-a-anomaly](#layer-a-anomaly).
   - Uptime/Latency falling → the operator's box is degrading; nothing to do, scoring
     is the incentive.
   - Stake falling → they unbonded or got slashed — expected mechanics.
3. Review the flag with a one-line diagnosis. There is deliberately no auto-slash.

## test

**Fired when:** an operator called `POST /v1/admin/alerts/test`. **Info** severity,
delivered through the REAL sink bypassing the severity floor and cooldown — this is the
end-to-end channel check, not an incident.

1. Seeing this in the channel means the webhook works. Done — that was the point.
2. Fire one yourself (e.g. after rotating the webhook URL):
   ```
   curl -s -X POST -H "X-Admin-Token: $TOKEN" https://gateway.querais.xyz/v1/admin/alerts/test
   ```
   `200 {"delivered":true}` + a message in the channel = healthy.
   `502` = the gateway is fine, the WEBHOOK is not — recreate it (Discord: channel →
   Integrations → Webhooks) and `fly secrets set GATEWAY_ALERT_WEBHOOK_URL=... -a querais-gateway`.
   Never paste the webhook URL into logs, issues, or chat — it embeds a channel token.
3. Log drills in `RUNBOOK_KEYS.md` §6 alongside the pause drills.
