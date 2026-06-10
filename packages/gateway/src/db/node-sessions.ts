import type { Address } from 'viem';
import type { GatewayDb } from './index.js';

/** A node's connected interval; end === null means the session is still open. */
export interface SessionInterval {
  start: number;
  end: number | null;
}

/**
 * Connect/disconnect session intervals per node wallet — the raw material for the
 * Uptime dimension (Slice 4). One row per WS session, opened on a successful
 * handshake and closed when the socket drops; `last_seen` advances on every ws pong
 * so a crash leaves an honest upper bound for recovery. Timestamps are ms epochs.
 */
export class NodeSessionStore {
  constructor(private readonly db: GatewayDb) {}

  /** Open a session at handshake time. */
  open(wallet: Address, atMs: number): void {
    this.db.conn
      .prepare(`INSERT INTO node_sessions(wallet, connected_at, last_seen) VALUES(?, ?, ?)`)
      .run(wallet.toLowerCase(), atMs, atMs);
  }

  /** Close the wallet's open session(s) when its socket drops. */
  close(wallet: Address, atMs: number): void {
    this.db.conn
      .prepare(
        `UPDATE node_sessions SET disconnected_at=?, last_seen=?
         WHERE wallet=? AND disconnected_at IS NULL`,
      )
      .run(atMs, atMs, wallet.toLowerCase());
  }

  /** Advance last_seen (ws pong received — the node is alive). */
  touch(wallet: Address, atMs: number): void {
    this.db.conn
      .prepare(`UPDATE node_sessions SET last_seen=? WHERE wallet=? AND disconnected_at IS NULL`)
      .run(atMs, wallet.toLowerCase());
  }

  /**
   * Boot crash-recovery: a session left open by a crashed gateway is closed at its
   * last_seen (the honest bound — we cannot know the node stayed up after that).
   */
  closeAllOpen(): void {
    this.db.conn.exec(
      `UPDATE node_sessions SET disconnected_at = last_seen WHERE disconnected_at IS NULL`,
    );
  }

  /** Sessions overlapping [sinceMs, now] for the Uptime window. */
  intervalsSince(wallet: Address, sinceMs: number): SessionInterval[] {
    const rows = this.db.conn
      .prepare(
        `SELECT connected_at, disconnected_at FROM node_sessions
         WHERE wallet=? AND (disconnected_at IS NULL OR disconnected_at > ?)
         ORDER BY connected_at`,
      )
      .all(wallet.toLowerCase(), sinceMs) as {
      connected_at: number;
      disconnected_at: number | null;
    }[];
    return rows.map((r) => ({ start: r.connected_at, end: r.disconnected_at }));
  }

  /** Every wallet that has ever connected (the snapshot sweep's candidate set). */
  wallets(): Address[] {
    const rows = this.db.conn.prepare(`SELECT DISTINCT wallet FROM node_sessions`).all() as {
      wallet: string;
    }[];
    return rows.map((r) => r.wallet as Address);
  }

  /** When the node was last known alive (open session → its last_seen), or undefined. */
  lastActive(wallet: Address): number | undefined {
    const row = this.db.conn
      .prepare(`SELECT MAX(last_seen) AS last FROM node_sessions WHERE wallet=?`)
      .get(wallet.toLowerCase()) as { last: number | null } | undefined;
    return row?.last ?? undefined;
  }
}
