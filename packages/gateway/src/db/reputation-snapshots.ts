import type { Address, Hex } from 'viem';
import type { GatewayDb } from './index.js';

/** One published (or attempted) daily score snapshot for a node. */
export interface ReputationSnapshot {
  wallet: Address;
  compositeBps: number;
  accuracyBps: number;
  uptimeBps: number;
  latencyBps: number;
  longevityBps: number;
  stakeBps: number;
  /** The on-chain updateReputation tx that published this composite. */
  txHash: Hex;
  /** Rapid-decline manual-review flag (>2000 bps drop in any 7-day window). */
  flagged: boolean;
  createdAt: number;
}

interface SnapshotRow {
  wallet: string;
  composite_bps: number;
  accuracy_bps: number;
  uptime_bps: number;
  latency_bps: number;
  longevity_bps: number;
  stake_bps: number;
  tx_hash: string;
  flagged: number;
  created_at: number;
}

function decode(r: SnapshotRow): ReputationSnapshot {
  return {
    wallet: r.wallet as Address,
    compositeBps: r.composite_bps,
    accuracyBps: r.accuracy_bps,
    uptimeBps: r.uptime_bps,
    latencyBps: r.latency_bps,
    longevityBps: r.longevity_bps,
    stakeBps: r.stake_bps,
    txHash: r.tx_hash as Hex,
    flagged: r.flagged === 1,
    createdAt: r.created_at,
  };
}

/**
 * History of the scores the oracle published on-chain (Slice 4B). Each row mirrors one
 * `updateReputation` tx; the trail feeds rapid-decline detection and the audit story
 * ("what score did we publish, when, from which dimensions"). The chain stays the
 * source of truth for the live score — this is its queryable history.
 */
export class ReputationSnapshotStore {
  constructor(private readonly db: GatewayDb) {}

  insert(s: ReputationSnapshot): void {
    this.db.conn
      .prepare(
        `INSERT OR REPLACE INTO reputation_snapshots(
           wallet, composite_bps, accuracy_bps, uptime_bps, latency_bps, longevity_bps,
           stake_bps, tx_hash, flagged, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.wallet.toLowerCase(),
        s.compositeBps,
        s.accuracyBps,
        s.uptimeBps,
        s.latencyBps,
        s.longevityBps,
        s.stakeBps,
        s.txHash,
        s.flagged ? 1 : 0,
        s.createdAt,
      );
  }

  /** Highest composite published for this wallet since `sinceMs` (rapid-decline input). */
  maxCompositeSince(wallet: Address, sinceMs: number): number | undefined {
    const row = this.db.conn
      .prepare(
        `SELECT MAX(composite_bps) AS max FROM reputation_snapshots
         WHERE wallet=? AND created_at > ?`,
      )
      .get(wallet.toLowerCase(), sinceMs) as { max: number | null } | undefined;
    return row?.max ?? undefined;
  }

  latest(wallet: Address): ReputationSnapshot | undefined {
    const row = this.db.conn
      .prepare(`SELECT * FROM reputation_snapshots WHERE wallet=? ORDER BY created_at DESC LIMIT 1`)
      .get(wallet.toLowerCase()) as SnapshotRow | undefined;
    return row ? decode(row) : undefined;
  }
}
