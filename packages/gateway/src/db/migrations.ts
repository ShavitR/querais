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

  // 4 — Slice 3 surface hardening: faucet claims remember the claiming IP (per-IP daily
  // throttle + global daily cap query off claimed_at), and API keys carry a quota tier.
  `ALTER TABLE faucet_claims ADD COLUMN ip TEXT;
   CREATE INDEX idx_faucet_ip ON faucet_claims(ip, claimed_at);
   CREATE INDEX idx_faucet_claimed_at ON faucet_claims(claimed_at);
   ALTER TABLE api_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';`,

  // 5 — Slice 4 reputation telemetry. Per-job TTFT lives on the job row (the Latency
  // dimension is DERIVED from job rows — no counter tables); uptime comes from
  // connect/disconnect session intervals; node_reputation holds the gateway-side
  // accuracy-EMA working state (seeded at 7000, NEVER from the on-chain composite);
  // reputation_snapshots receives the daily published scores (first written in 4B —
  // shipped here so the slice needs one migration). Timestamps are ms epochs.
  `ALTER TABLE jobs ADD COLUMN first_token_ms INTEGER;
   CREATE INDEX idx_jobs_provider ON jobs(provider, created_at);
   CREATE TABLE node_sessions (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     wallet          TEXT NOT NULL,
     connected_at    INTEGER NOT NULL,
     disconnected_at INTEGER,
     last_seen       INTEGER NOT NULL
   );
   CREATE INDEX idx_node_sessions_wallet ON node_sessions(wallet, connected_at);
   CREATE TABLE node_reputation (
     wallet       TEXT PRIMARY KEY,
     accuracy_bps INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   );
   CREATE TABLE reputation_snapshots (
     wallet        TEXT NOT NULL,
     composite_bps INTEGER NOT NULL,
     accuracy_bps  INTEGER NOT NULL,
     uptime_bps    INTEGER NOT NULL,
     latency_bps   INTEGER NOT NULL,
     longevity_bps INTEGER NOT NULL,
     stake_bps     INTEGER NOT NULL,
     tx_hash       TEXT,
     flagged       INTEGER NOT NULL DEFAULT 0,
     created_at    INTEGER NOT NULL,
     PRIMARY KEY (wallet, created_at)
   );`,

  // 6 — Slice 5 Layer-A verification. Pattern detection derives from job rows (per the
  // no-counter-tables rule), so jobs gain the node's result hash + finish reason —
  // hashes only, NEVER prompt/output text (prompt privacy; sampled prompts live only in
  // the in-memory queue). layer_a_checks records each semantic-sampling verdict;
  // node_flags is the generic manual-review ledger (Layer-A anomalies, pattern hits).
  `ALTER TABLE jobs ADD COLUMN result_hash TEXT;
   ALTER TABLE jobs ADD COLUMN finish_reason TEXT;
   CREATE TABLE layer_a_checks (
     job_id         TEXT PRIMARY KEY,
     provider       TEXT NOT NULL,
     similarity_bps INTEGER NOT NULL,
     verdict        TEXT NOT NULL,
     oracle_runs    INTEGER NOT NULL,
     created_at     INTEGER NOT NULL
   );
   CREATE INDEX idx_layer_a_provider ON layer_a_checks(provider, created_at);
   CREATE TABLE node_flags (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     wallet     TEXT NOT NULL,
     kind       TEXT NOT NULL,
     detail     TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_node_flags_wallet ON node_flags(wallet, created_at);`,
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
