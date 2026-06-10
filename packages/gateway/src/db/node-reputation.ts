import type { Address } from 'viem';
import type { GatewayDb } from './index.js';

export interface AccuracyState {
  accuracyBps: number;
  updatedAt: number;
}

/**
 * The accuracy-EMA working state per node (Slice 4). This is the reputation oracle's
 * scratchpad, NOT the published score: the chain keeps the single composite, and
 * accuracy is deliberately never seeded from it (that would double-count the other
 * dimensions). Seeding at INITIAL_ACCURACY_BPS happens in ReputationService.
 */
export class NodeReputationStore {
  constructor(private readonly db: GatewayDb) {}

  get(wallet: Address): AccuracyState | undefined {
    const row = this.db.conn
      .prepare(`SELECT accuracy_bps, updated_at FROM node_reputation WHERE wallet=?`)
      .get(wallet.toLowerCase()) as { accuracy_bps: number; updated_at: number } | undefined;
    return row ? { accuracyBps: row.accuracy_bps, updatedAt: row.updated_at } : undefined;
  }

  set(wallet: Address, accuracyBps: number): void {
    this.db.conn
      .prepare(
        `INSERT INTO node_reputation(wallet, accuracy_bps, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(wallet) DO UPDATE SET accuracy_bps=excluded.accuracy_bps,
           updated_at=excluded.updated_at`,
      )
      .run(wallet.toLowerCase(), accuracyBps, Date.now());
  }
}
