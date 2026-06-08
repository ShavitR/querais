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
