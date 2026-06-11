import type { Address, Hex } from 'viem';
import type { GatewayDb } from './index.js';

/** A single off-chain debit owed to a provider, before it's flushed on-chain. */
export interface DebitEntry {
  jobId: Hex;
  requester: Address;
  provider: Address;
  amountWei: bigint;
  tokens: number;
}

interface DebitRow {
  job_id: string;
  requester: string;
  provider: string;
  amount_wei: string;
  tokens: number;
}

/**
 * The off-chain signed-debit ledger: what the gateway owes providers between on-chain
 * `batchSettle` flushes. Durable (Slice 1 DB) so a restart never loses an unsettled debit.
 * Bounded by the requester's signed cap — the chain is the source of truth for value.
 */
export class DebitLedgerStore {
  constructor(private readonly db: GatewayDb) {}

  /** Record a settled-but-unflushed debit (INSERT OR REPLACE — a retried jobId overwrites). */
  record(d: DebitEntry): void {
    this.db.conn
      .prepare(
        `INSERT OR REPLACE INTO debit_entries(
           job_id, requester, provider, amount_wei, tokens, batch_id, created_at)
         VALUES(?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        d.jobId,
        d.requester.toLowerCase(),
        d.provider.toLowerCase(),
        d.amountWei.toString(),
        d.tokens,
        Date.now(),
      );
  }

  /** Debits for a requester not yet flushed on-chain (batch_id IS NULL). */
  pending(requester: Address): DebitEntry[] {
    const rows = this.db.conn
      .prepare(
        `SELECT job_id, requester, provider, amount_wei, tokens FROM debit_entries
         WHERE requester=? AND batch_id IS NULL ORDER BY created_at`,
      )
      .all(requester.toLowerCase()) as unknown as DebitRow[];
    return rows.map((r) => ({
      jobId: r.job_id as Hex,
      requester: r.requester as Address,
      provider: r.provider as Address,
      amountWei: BigInt(r.amount_wei),
      tokens: r.tokens,
    }));
  }

  /** When the oldest unflushed debit was recorded (ms), or undefined if none pending.
   *  Slice 8: feeds the `stuck-debits` alert + the oldest-debit-age /metrics gauge. */
  oldestPendingCreatedAt(): number | undefined {
    const row = this.db.conn
      .prepare('SELECT MIN(created_at) AS t FROM debit_entries WHERE batch_id IS NULL')
      .get() as { t: number | null };
    return row.t ?? undefined;
  }

  /** Unflushed debit rows network-wide — the `querais_pending_debits` gauge. */
  pendingCount(): number {
    const row = this.db.conn
      .prepare('SELECT COUNT(*) AS n FROM debit_entries WHERE batch_id IS NULL')
      .get() as { n: number };
    return row.n;
  }

  /** Total wei of all unflushed debits — the gateway's outstanding liability gauge. */
  pendingValueWei(): bigint {
    const rows = this.db.conn
      .prepare('SELECT amount_wei FROM debit_entries WHERE batch_id IS NULL')
      .all() as { amount_wei: string }[];
    return rows.reduce((sum, r) => sum + BigInt(r.amount_wei), 0n);
  }

  /** Distinct requesters that currently have unflushed debits. */
  requestersWithPending(): Address[] {
    const rows = this.db.conn
      .prepare('SELECT DISTINCT requester FROM debit_entries WHERE batch_id IS NULL')
      .all() as { requester: string }[];
    return rows.map((r) => r.requester as Address);
  }

  /**
   * Stamp a set of jobs as flushed in batch `batchId` — normally the settle tx hash, or a
   * `recovered:*` sentinel when reconciliation finds a debit already settled on-chain.
   * Atomic: a crash mid-update can't leave a batch half-marked.
   */
  markBatched(jobIds: Hex[], batchId: string): void {
    const stmt = this.db.conn.prepare('UPDATE debit_entries SET batch_id=? WHERE job_id=?');
    this.db.conn.exec('BEGIN');
    try {
      for (const id of jobIds) stmt.run(batchId, id);
      this.db.conn.exec('COMMIT');
    } catch (err) {
      this.db.conn.exec('ROLLBACK');
      throw err;
    }
  }
}
