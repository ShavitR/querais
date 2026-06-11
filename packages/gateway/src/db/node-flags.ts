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
  /** NULL = open (Slice 8 review queue); set when a human marks it reviewed. */
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}

interface FlagRow {
  id: number;
  wallet: string;
  kind: string;
  detail: string;
  created_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  review_note: string | null;
}

function decode(r: FlagRow): NodeFlag {
  return {
    id: r.id,
    wallet: r.wallet as Address,
    kind: r.kind as NodeFlagKind,
    detail: r.detail,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    reviewNote: r.review_note,
  };
}

/** Filters for the admin review-queue listing (GET /v1/admin/flags). */
export interface FlagListOptions {
  status?: 'open' | 'all';
  wallet?: Address;
  limit?: number;
  offset?: number;
}

/**
 * The manual-review ledger: every entry is a human's to-do, never an automatic
 * punishment (the spec is explicit — anomaly flags raise review/disputes, not slashes).
 * Slice 8 makes the to-do explicit: a flag stays "open" until markReviewed.
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
    return rows.map(decode);
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
    return row ? decode(row) : undefined;
  }

  // ── Slice 8 review queue ──────────────────────────────────────────────────────

  get(id: number): NodeFlag | undefined {
    const row = this.db.conn.prepare(`SELECT * FROM node_flags WHERE id=?`).get(id) as
      | FlagRow
      | undefined;
    return row ? decode(row) : undefined;
  }

  /** Newest-first listing for the admin queue; defaults to open flags only. */
  list(opts: FlagListOptions = {}): NodeFlag[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if ((opts.status ?? 'open') === 'open') where.push('reviewed_at IS NULL');
    if (opts.wallet) {
      where.push('wallet=?');
      params.push(opts.wallet.toLowerCase());
    }
    const sql =
      `SELECT * FROM node_flags` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
    params.push(Math.min(opts.limit ?? 50, 500), opts.offset ?? 0);
    const rows = this.db.conn.prepare(sql).all(...params) as unknown as FlagRow[];
    return rows.map(decode);
  }

  /** Unreviewed flags network-wide — the `querais_open_flags` gauge + sweep rule. */
  openCount(): number {
    const row = this.db.conn
      .prepare(`SELECT COUNT(*) AS n FROM node_flags WHERE reviewed_at IS NULL`)
      .get() as { n: number };
    return row.n;
  }

  /** Unreviewed flags for one node — what /v1/nodes shows requesters (Slice 8:
   *  reviewed history stops scaring them; it stays queryable via the admin route). */
  openCountFor(wallet: Address): number {
    const row = this.db.conn
      .prepare(`SELECT COUNT(*) AS n FROM node_flags WHERE wallet=? AND reviewed_at IS NULL`)
      .get(wallet.toLowerCase()) as { n: number };
    return row.n;
  }

  /** Mark a flag reviewed. Reports why it didn't apply so the route can 404/409. */
  markReviewed(
    id: number,
    by: string,
    note?: string,
  ):
    | { outcome: 'ok'; flag: NodeFlag }
    | { outcome: 'not-found' }
    | { outcome: 'already-reviewed' } {
    const existing = this.get(id);
    if (!existing) return { outcome: 'not-found' };
    if (existing.reviewedAt !== null) return { outcome: 'already-reviewed' };
    this.db.conn
      .prepare(`UPDATE node_flags SET reviewed_at=?, reviewed_by=?, review_note=? WHERE id=?`)
      .run(Date.now(), by, note ?? null, id);
    return { outcome: 'ok', flag: this.get(id)! };
  }
}
