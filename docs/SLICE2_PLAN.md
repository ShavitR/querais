# Slice 2 — Batched session-deposit settlement

Companion to `docs/EXECUTION_PLAN.md` (Slice 2). This is the execution detail.

## Why this is the marquee work

Today every API call is 1–4 on-chain txs: `createJob` (locks QAIS) + `assignJob` before
inference, then `completeJob` + `verifyAndRelease` after (`gateway/src/dispatcher.ts`). That's a
working demo, not a marketplace. The whitepaper's economic core — pre-funded credit accounts →
EIP-712 signed spend → `batchSettle` → withdraw-after-notice — is **specified but unbuilt**, and
everything economic (tokenomics, node earnings at volume) sits on top of it.

**Goal:** 100 calls settle in **1 tx**; the requester signs **zero** per-call wallet txs;
worst-case loss is bounded (settle only at signed prices, no principal theft); `pnpm test:e2e`
gains a batched-settlement scenario.

## Design constraint (inherits Slice 1's "thin DB" principle)

The on-chain `CreditAccount` is the **source of truth** for deposited value; the requester's
EIP-712 signed cap is the on-chain authorization that **bounds** what the gateway can ever debit.
The off-chain signed-debit ledger in SQLite is the durable record of what's owed *between* batch
settlements (called out as the one must-be-durable piece in `SLICE1_PLAN.md`). A compromised
gateway can only settle up to each signed cap, at the prices in the signed debits, to providers —
it can never move principal beyond a cap. This matches the Phase-1 trust model (HANDOFF §10).

## Scope decision: branch the dispatcher (not a drop-in Settlement swap)

The `Settlement` seam (`settle`/`fail`) is only invoked *after* `createJob`+`assignJob` already
hit the chain per job. Swapping only `Settlement` would not reduce per-call gas. So for deposited
requesters the dispatcher **skips the per-job on-chain lock/assign/verify entirely** and records an
off-chain signed debit; `CreditAccount.batchSettle` moves the money in one tx at flush. Requesters
without a deposit keep the existing `JobEscrow` per-job path as **fallback**.

## New contract — `CreditAccount.sol` (additive; existing 3 contracts untouched)

Mirrors `JobEscrow.sol`: OZ `AccessControl` + `ReentrancyGuard` + `Pausable` + `SafeERC20`, custom
errors, events, strict CEI, integer wei + basis points (reuses the 500-bps / 10000-denominator fee
convention). Adds OZ `EIP712` + `ECDSA` (first EIP-712 in the repo).

- **`deposit(uint256 amount)`** — requester pre-approves and deposits QAIS; `balance[msg.sender] += amount`. Infrequent.
- **`SpendingCap { address requester, address settler, uint256 maxSpendWei, uint256 nonce, uint256 deadline }`** — EIP-712 typed struct the requester signs once per session (off-chain, zero gas).
- **`batchSettle(SpendingCap cap, bytes sig, Debit[] debits)`** — `SETTLER_ROLE` only (the gateway, which pays gas). Recovers the signer (`== cap.requester`), checks `block.timestamp <= cap.deadline` and `cap.settler == msg.sender`; requires `spentAgainst[requester][nonce] + sum(debits) <= cap.maxSpendWei` **and** `<= balance[requester]` (cumulative across batches → incremental settlement on one signature). For each `{provider, amountWei}`: 95% → provider, 5% → treasury, decrement balance, bump `spentAgainst`. Emits `BatchSettled` + per-debit events. CEI: all balance effects before any transfer.
- **Withdraw-after-notice** — `initiateWithdrawal()` starts a `WITHDRAWAL_NOTICE` window; `completeWithdrawal()` returns remaining balance after it. Lets the gateway flush pending debits before funds leave; bounds worst case.
- **Admin** — `setTreasury`, `pause`/`unpause`; treasury + token + admin set in constructor (same shape as JobEscrow).

Pipeline wiring: `scripts/deploy.ts` (deploy standalone after JobEscrow, grant gateway
`SETTLER_ROLE`), `scripts/export-abis.ts` (`creditAccountAbi`), `src/addresses.ts`
(`contracts.creditAccount`), `deployments/addresses.<network>.json`. Existing addresses preserved.

## Shared — `packages/shared/src/spending-cap.ts` (new)

EIP-712 domain `{ name: 'QueraIS CreditAccount', version: '1', chainId, verifyingContract }`, the
`SpendingCap` typed-data + a zod schema, and viem helpers (`hashTypedData` / `signTypedData` /
`recoverTypedDataAddress`). Re-exported via the shared barrel; unit-tested (sign → recover
round-trip; the digest matches the contract's `_hashTypedDataV4`).

## Off-chain signed-debit ledger — Slice 1 DB pattern

New migration appended to `gateway/src/db/migrations.ts`:
- `credit_sessions(api_key, requester, settler, max_spend_wei TEXT, nonce, deadline, signature, spent_wei TEXT, active, created_at)`
- `debit_entries(job_id PK, requester, provider, amount_wei TEXT, tokens, batch_id, settle_tx, created_at)` + index on `batch_id`.

New `DebitLedgerStore` (`gateway/src/db/ledger.ts`) following `JobStore`: string-encoded wei,
parameterized statements, decode-on-read. Records a debit per settled batched job; stamps
`batch_id` + `settle_tx` on flush.

## Gateway — `BatchedSettlement` + dispatcher branch

- **`gateway/src/batched-settlement.ts`** — `class BatchedSettlement implements Settlement`. `settle(ctx)` records a signed debit against the requester's active session and accrues a pending tally; a flusher (every `M` jobs / `T` seconds, or on demand for tests) groups pending debits by requester and calls `creditAccount.batchSettle(cap, sig, debits)` in 1 tx, then stamps `batch_id`/`settle_tx`. Reputation EMA still posts per job via `chain.getNode`/`updateReputation` (NodeRegistry, settlement-venue-independent) — reuse `emaReputationBps`. `fail` records no debit; provider still EMA-down + slashed via `chain.updateReputation`/`chain.slash`.
- **`POST /v1/sessions`** — accepts a signed `SpendingCap`, verifies the signature, persists to `credit_sessions`, marks active for that API key's wallet.
- **Dispatcher branch** — if the requester has an active session, skip the `createJob`/`assignJob`/`verifyAndRelease` block; run inference; `settle`/`fail` via the batched path. No session → unchanged path. Both impls available at `buildGateway`; the dispatcher selects per request.

## SDK — `packages/sdk/src/client.ts`

Optional `privateKey?: Hex` in the constructor; new `openSession({ maxSpendWei, deadline })` signs
the EIP-712 cap (viem `signTypedData`) and POSTs to `/v1/sessions`. After that, `chat()` settles
through the batched path with no per-call signing.

## Increments (branch + PR each, green bar gated)

- **Slice 2A — contract + shared types (no runtime wiring).** `CreditAccount.sol` + tests (conservation `sum(provider)+fee == debited`; `debited <= deposit` and `<= cap`; signature/nonce/deadline/settler; cross-batch over-cap + replay rejection; withdraw-after-notice; reentrancy via `ReentrantToken`; gas-per-job benchmark). Pipeline wiring + `spending-cap.ts` round-trip tests. **Checkpoint: deploy CreditAccount to Arbitrum Sepolia** (additive; confirm before spending testnet gas).
- **Slice 2B — off-chain ledger + gateway + SDK + e2e.** DB migration + `DebitLedgerStore`; `BatchedSettlement` + flusher; `POST /v1/sessions`; dispatcher branch; SDK `openSession`; `runBatchedSettlementCase()` in `test-e2e/src/e2e.ts` + `run-e2e.ts`.

## Acceptance

- 100 (test uses 10) calls settle in **1** `batchSettle` tx; the requester sends **0** per-call txs.
- Conservation holds on-chain and is fuzz-tested; over-cap / replay / expired-cap / wrong-settler all revert.
- Withdraw-after-notice returns the residual; pending debits flush first.
- Full green bar stays green; `pnpm test:e2e` remains self-contained (`:memory:`), gains the scenario.
- Trust model unchanged: the DB ledger is bounded by the on-chain signed cap; no principal theft path.

## Verification

- 2A: `pnpm --filter @querais/contracts test` (incl. new CreditAccount tests + gas benchmark) +
  `pnpm --filter @querais/shared test` (spending-cap round-trip) → green; then full green bar.
- 2B: `pnpm test:e2e` → `runBatchedSettlementCase` asserts 1 settle tx / 0 requester txs, shared
  `batch_id`, and the 95/5 split in provider/treasury balances.
- Live (after merge): deposit + `openSession` against `pnpm gateway:sepolia`, fire SDK jobs at the
  running node, confirm one on-chain `BatchSettled` covers the batch.
