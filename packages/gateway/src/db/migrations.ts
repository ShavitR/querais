import type { DatabaseSync } from 'node:sqlite';

/**
 * Forward-only migrations, applied in order. Each entry is the SQL that moves the schema
 * from version i to i+1; the applied count is tracked in SQLite's `user_version` pragma.
 * Append new migrations — never edit a released one.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — operational stores: API keys and faucet claims (the two restart "holes").
  `CREATE TABLE api_keys (
     key        TEXT PRIMARY KEY,
     wallet     TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE faucet_claims (
     address    TEXT PRIMARY KEY,
     qais_tx    TEXT,
     eth_tx     TEXT,
     claimed_at INTEGER NOT NULL
   );`,

  // 2 — job records: a queryable mirror of the on-chain escrow lifecycle (chain stays
  // authoritative). Usage/credits are DERIVED by aggregating this table — no second table
  // to keep in sync. wei amounts are TEXT (they overflow SQLite's 64-bit INTEGER).
  `CREATE TABLE jobs (
     job_id           TEXT PRIMARY KEY,
     requester        TEXT NOT NULL,
     provider         TEXT NOT NULL,
     model            TEXT NOT NULL,
     status           TEXT NOT NULL,
     max_tokens       INTEGER NOT NULL,
     actual_tokens    INTEGER,
     agreed_price_wei TEXT NOT NULL,
     locked_wei       TEXT NOT NULL,
     payment_wei      TEXT,
     provider_pay_wei TEXT,
     fee_wei          TEXT,
     reason           TEXT,
     created_at       INTEGER NOT NULL,
     updated_at       INTEGER NOT NULL
   );
   CREATE INDEX idx_jobs_requester ON jobs(requester, status);`,

  // 3 — Slice 2 batched settlement: the requester's signed spending cap (one active
  // session per requester) and the off-chain signed-debit ledger that accumulates what's
  // owed between on-chain batchSettle flushes. The on-chain CreditAccount + the signed cap
  // remain the source of truth / bound; these rows are the gateway's durable working set.
  // wei amounts are TEXT (they overflow SQLite's 64-bit INTEGER).
  `CREATE TABLE credit_sessions (
     requester      TEXT PRIMARY KEY,
     settler        TEXT NOT NULL,
     max_spend_wei  TEXT NOT NULL,
     nonce          TEXT NOT NULL,
     deadline       INTEGER NOT NULL,
     signature      TEXT NOT NULL,
     created_at     INTEGER NOT NULL
   );
   CREATE TABLE debit_entries (
     job_id      TEXT PRIMARY KEY,
     requester   TEXT NOT NULL,
     provider    TEXT NOT NULL,
     amount_wei  TEXT NOT NULL,
     tokens      INTEGER NOT NULL,
     batch_id    TEXT,
     created_at  INTEGER NOT NULL
   );
   CREATE INDEX idx_debits_pending ON debit_entries(requester, batch_id);`,
];

/** Apply any migrations the database hasn't seen yet. Idempotent and safe to call on boot. */
export function runMigrations(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      // user_version takes a literal, not a bound param — v is a controlled integer.
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** The number of migrations defined (exported for tests). */
export const MIGRATION_COUNT = MIGRATIONS.length;
