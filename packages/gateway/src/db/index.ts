import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';

/**
 * The gateway's durable operational state — a single synchronous SQLite connection shared by
 * the stores (API keys, faucet claims, and later job/usage records).
 *
 * Deliberately thin: this is the Phase-1 coordinator's bookkeeping, NOT the source of truth for
 * value or trust (that stays on-chain). It is a cache/index, kept minimal so it's cheap to
 * dismantle when Phase 4 decomposes the gateway. Storage lives behind this seam, so a Postgres
 * dialect can replace it later without touching callers.
 *
 * `path` undefined → an in-memory database (tests, e2e — keeps them self-contained). A file
 * path (`GATEWAY_DB_PATH`) persists across restarts.
 */
export class GatewayDb {
  readonly conn: DatabaseSync;

  constructor(path?: string) {
    this.conn = new DatabaseSync(path ?? ':memory:');
    // WAL improves concurrent read/write durability on a real file (a no-op for :memory:).
    this.conn.exec('PRAGMA journal_mode = WAL');
    this.conn.exec('PRAGMA foreign_keys = ON');
    runMigrations(this.conn);
  }

  close(): void {
    this.conn.close();
  }
}
