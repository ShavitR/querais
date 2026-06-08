# Slice 1 — Persistence behind repositories

Companion to `docs/EXECUTION_PLAN.md` (Slice 1). This is the execution detail.

## Design constraint (the "thin DB" principle)

The gateway is the Phase-1 trusted coordinator; this DB is **its** operational state, nothing
more. It is **never the source of truth for value or trust** — payments, escrow, staking,
slashing, and reputation stay on-chain, enforced by the contracts. The DB is a durable
**cache/index** for the coordinator:

- Job records mirror what's already on-chain (rebuildable from chain events).
- API-key→wallet and faucet claims are off-chain operational bookkeeping (testnet).
- The usage/signed-debit ledger (Slice 2) is the one piece that *must* be durable — it holds
  what's owed *between* on-chain batch settlements.

Corollary: keep it **minimal and dismantlable**. When Phase 4 decomposes the gateway, this
shrinks or moves on-chain/p2p. So: a thin repository seam, single dialect, no heavy infra.

## Stack (decided after reading the seams)

- **`node:sqlite`** (Node's built-in, synchronous SQLite — added in 22.5, unflagged from 22.13,
  which is exactly our Node floor since pnpm itself depends on it). **Zero new runtime deps, no
  native build, no CI friction.** Chosen over Drizzle/better-sqlite3 because (a) the existing
  seams (`ApiKeyStore`, `Faucet`) are synchronous, and `node:sqlite` is synchronous → no async
  ripple into routes; (b) the thin-DB principle favors minimal deps; (c) Node 26 is bleeding-edge
  and `better-sqlite3` may lack prebuilds for its ABI.
- **One shared `GatewayDb`** = one connection + a tiny migration runner (PRAGMA `user_version`).
  SQLite file in prod (`GATEWAY_DB_PATH`), `:memory:` in tests/e2e → stays self-contained.
- **Repository seam**: storage is hidden behind the existing classes (`ApiKeyStore`, `Faucet`)
  and small repos (`JobRepo`, `UsageRepo`); a Postgres dialect can replace `node:sqlite` later
  (the deferred P3.6 multi-gateway work) without touching callers.

## Scope, staged (two increments on one branch/PR)

**Increment A — close the durability holes (keys + faucet):**
- `db/migrations.ts` + `db/index.ts` (`GatewayDb`): tables `api_keys`, `faucet_claims`.
- Back `ApiKeyStore` with the DB (constructor takes `GatewayDb`; `get/issue/count` unchanged).
- Back `Faucet` claims with the DB. The reserve-before-tx becomes an **atomic `INSERT` on a
  PRIMARY KEY** → real cross-restart Sybil throttle (fixes the in-memory `Set` that reset on
  restart). Delete-on-failure preserves retry.
- `config.ts`: `apiKeyStorePath`→`dbPath` (`GATEWAY_DB_PATH`). `deps.ts`: add `db`.
  `server.ts`: open one `GatewayDb`, inject into both stores.
- Update `key-store.test.ts` / `faucet.test.ts` to the new ctors; add `db.test.ts` (migration
  idempotency, atomic double-claim, restart-survival on a temp file).

**Increment B — job records + usage:**
- Migration 2: `jobs` (jobId, requester, provider, status, tokens, prices, settlement tx,
  timestamps) + `usage` (per-key counters).
- `JobRepo`/`UsageRepo`; dispatcher/settlement write a job row on create→assign→settle/fail;
  per-key usage incremented on settle.
- `GET /v1/jobs/:id` reads DB **and** chain (chain authoritative for status); new `GET /v1/usage`
  returns per-key history. Both behind the existing auth seam.

## Acceptance

- Keys, faucet claims, and job rows **survive a gateway restart** (new `db.test.ts` + a restart
  assertion); a second faucet claim is refused even across a fresh process.
- `/v1/jobs/:id` returns chain status + persisted metadata; `/v1/usage` returns per-key totals.
- Full green bar stays green; `pnpm test:e2e` remains self-contained (`:memory:`), no new service.
- No change to the trust model: nothing fund-moving reads from the DB.

## Verification

- `pnpm --filter @querais/gateway test` (unit, incl. new db.test.ts) → green.
- `pnpm test:e2e` → 6 scenarios still pass (faucet/onboarding now DB-backed in-memory).
- Manual restart check: run gateway with a file `GATEWAY_DB_PATH`, issue a key + claim faucet,
  restart, confirm both persist.
