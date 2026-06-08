import { randomBytes } from 'node:crypto';
import type { Address } from '@querais/shared';
import type { GatewayDb } from './db/index.js';

/**
 * API-key → requester-wallet store, backed by the shared {@link GatewayDb}. Seeded from env
 * (static dev keys, inserted if absent) and durable across restarts. `issue()` mints a new
 * self-serve key bound to a wallet. The public surface (`get`/`issue`/`count`) is unchanged
 * from the previous JSON-file implementation, so route handlers are untouched.
 */
export class ApiKeyStore {
  constructor(
    private readonly db: GatewayDb,
    seed?: Map<string, Address>,
  ) {
    if (seed) {
      const insert = db.conn.prepare(
        'INSERT OR IGNORE INTO api_keys(key, wallet, created_at) VALUES(?, ?, ?)',
      );
      const now = Date.now();
      for (const [k, v] of seed) insert.run(k, v.toLowerCase(), now);
    }
  }

  get(key: string): Address | undefined {
    const row = this.db.conn.prepare('SELECT wallet FROM api_keys WHERE key = ?').get(key) as
      | { wallet: string }
      | undefined;
    return row?.wallet as Address | undefined;
  }

  /** Mint a new API key bound to a (lowercased) wallet, persist, and return it. */
  issue(wallet: Address): string {
    const key = `sk-querais-${randomBytes(18).toString('hex')}`;
    this.db.conn
      .prepare('INSERT INTO api_keys(key, wallet, created_at) VALUES(?, ?, ?)')
      .run(key, wallet.toLowerCase(), Date.now());
    return key;
  }

  count(): number {
    const row = this.db.conn.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number };
    return row.n;
  }
}
