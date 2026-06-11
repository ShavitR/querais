import type { Address } from 'viem';
import type { GatewayDb } from './index.js';

/** What raised the flag. Layer-A anomalies and pattern hits land here (Slice 5). */
export type NodeFlagKind = 'layer-a:anomaly' | 'pattern:duplicate-output' | 'pattern:truncation';

export interface NodeFlag {
  id: number;
  wallet: Address;
  kind: NodeFlagKind;
  detail: string;
  createdAt: number;
}

interface FlagRow {
  id: number;
  wallet: string;
  kind: string;
  detail: string;
  created_at: number;
}

/**
 * The manual-review ledger: every entry is a human's to-do, never an automatic
 * punishment (the spec is explicit — anomaly flags raise review/disputes, not slashes).
 */
export class NodeFlagStore {
  constructor(private readonly db: GatewayDb) {}

  add(wallet: Address, kind: NodeFlagKind, detail: string): void {
    this.db.conn
      .prepare(`INSERT INTO node_flags(wallet, kind, detail, created_at) VALUES(?, ?, ?, ?)`)
      .run(wallet.toLowerCase(), kind, detail, Date.now());
  }

  forWallet(wallet: Address): NodeFlag[] {
    const rows = this.db.conn
      .prepare(`SELECT * FROM node_flags WHERE wallet=? ORDER BY created_at`)
      .all(wallet.toLowerCase()) as unknown as FlagRow[];
    return rows.map((r) => ({
      id: r.id,
      wallet: r.wallet as Address,
      kind: r.kind as NodeFlagKind,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  }

  countFor(wallet: Address): number {
    const row = this.db.conn
      .prepare(`SELECT COUNT(*) AS n FROM node_flags WHERE wallet=?`)
      .get(wallet.toLowerCase()) as { n: number };
    return row.n;
  }

  /** Latest flag of a kind — pattern sweeps use it to avoid re-flagging every run. */
  latestOfKind(wallet: Address, kind: NodeFlagKind): NodeFlag | undefined {
    const row = this.db.conn
      .prepare(
        `SELECT * FROM node_flags WHERE wallet=? AND kind=? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(wallet.toLowerCase(), kind) as FlagRow | undefined;
    return row
      ? {
          id: row.id,
          wallet: row.wallet as Address,
          kind: row.kind as NodeFlagKind,
          detail: row.detail,
          createdAt: row.created_at,
        }
      : undefined;
  }
}
