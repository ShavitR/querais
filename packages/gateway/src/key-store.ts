import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Address } from '@querais/shared';

/**
 * API-key → requester-wallet store. Seeded from env (static dev keys) and, if a path is
 * given, persisted to a JSON file so self-serve-issued keys survive restarts. Replaces
 * the static env-only map; `issue()` mints a new key for a wallet.
 */
export class ApiKeyStore {
  private readonly keys = new Map<string, Address>();

  constructor(
    private readonly path: string | undefined,
    seed?: Map<string, Address>,
  ) {
    if (seed) for (const [k, v] of seed) this.keys.set(k, v.toLowerCase() as Address);
    if (path && existsSync(path)) {
      const obj = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) this.keys.set(k, v.toLowerCase() as Address);
    }
  }

  get(key: string): Address | undefined {
    return this.keys.get(key);
  }

  /** Mint a new API key bound to a wallet, persist, and return it. */
  issue(wallet: Address): string {
    const key = `sk-querais-${randomBytes(18).toString('hex')}`;
    this.keys.set(key, wallet.toLowerCase() as Address);
    this.persist();
    return key;
  }

  count(): number {
    return this.keys.size;
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.keys), null, 2), 'utf8');
  }
}
