# Node incentive programs (Slice 6C)

The gateway **computes** payout recommendations from telemetry the protocol already
collects; the **operator executes** them from the cold admin key via
`ProtocolTreasury.allocate()`. The gateway never moves this money.

## The three programs (formulas)

| Program | Formula | Source data |
|---|---|---|
| **Uptime pool** | A per-epoch budget (`GATEWAY_INCENTIVE_UPTIME_POOL_QAIS`, default 100 QAIS) split **equally** among active nodes with 30-day uptime ≥ 95% (`GATEWAY_INCENTIVE_UPTIME_THRESHOLD_BPS`), each share scaled by the tenure multiplier. Equal — not stake-weighted — because stake already earns the 6B staking rewards; this pool pays for *reliability itself*. | Slice-4 `node_sessions` intervals |
| **First-model bonus** | One-time `GATEWAY_INCENTIVE_FIRST_MODEL_QAIS` (default 50 QAIS) to the provider that settled the **first verified job** for each model (ties broken deterministically by job id). | Slice-1 job rows |
| **Bootstrap launch bonus** | One-time `GATEWAY_INCENTIVE_BOOTSTRAP_QAIS` (default 5,000 QAIS, per go-to-market: "first 100 nodes that run for 30 days") to the earliest-registered `GATEWAY_INCENTIVE_BOOTSTRAP_MAX_NODES` **active** nodes with tenure ≥ `GATEWAY_INCENTIVE_BOOTSTRAP_MIN_TENURE_DAYS`. Phase-1 approximation: registration order is taken over *currently active* nodes (unbonded ones are gone from the registry). | on-chain `registeredAt` |

**Tenure multiplier** (token economics §9 loyalty table, applied by node tenure as the
Phase-1 proxy for "holding period" — true unmoved-earnings tracking needs wallet outflow
analysis, deferred): 0–29d ×1.00 · 30–59d ×1.05 · 60–89d ×1.15 · 90d+ ×1.25. Applied to
the uptime-pool share only; the fixed bonuses stay fixed. The table's routing-boost
column (+bid score) touches pure `matching` and is deferred with it.

## Why there is no payout table (paid-state is on-chain)

Every `allocate()` emits `Allocated(recipient, amount, purpose)`. One-time bonuses use
**canonical purpose strings** — `incentive:first-model:<model>`,
`incentive:bootstrap:<wallet>`, `incentive:uptime:<YYYY-MM-DD>:<wallet>` — and the
recommendation engine drops any line whose purpose already appears in the event log.
The thin-DB rule holds: there is no payout bookkeeping that can drift; re-querying
after a payout is the reconciliation.

## Operator flow (copy-pasteable)

```bash
# 1. Get the recommendation (admin token = GATEWAY_ADMIN_TOKEN):
curl -H "x-admin-token: $ADMIN" https://<gateway>/v1/admin/incentives | jq .

# 2. Check fundsSufficient — allocate() spends only the treasury's retained ops share
#    (the 60%); if short, wait for the next distribute() sweep or lower the budgets.

# 3. Execute each payout line EXACTLY as given (the purpose string is the dedup key),
#    signed by the COLD admin key:
pnpm ops:allocate -- --network arbitrumSepolia \
  --recipient 0x... --amount 50 --purpose "incentive:first-model:llama3"

# 4. Re-query step 1 — paid lines disappear (deduped against the Allocated events).
```

Exercised end-to-end on every `pnpm test:e2e` (the incentives scenario runs the real
`scripts/allocate.ts` against the local chain).
