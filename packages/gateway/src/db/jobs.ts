import type { Address, Hex } from 'viem';
import type { GatewayDb } from './index.js';

export type JobStatus = 'assigned' | 'verified' | 'failed';

/** What the dispatcher knows when a job is locked + assigned on-chain. */
export interface AssignedJob {
  jobId: Hex;
  requester: Address;
  provider: Address;
  model: string;
  maxTokens: number;
  agreedPriceWei: bigint;
  lockedWei: bigint;
}

/** Settlement figures, computed off-chain with the same integer math as the contract. */
export interface SettledJob {
  actualTokens: number;
  paymentWei: bigint;
  providerPayWei: bigint;
  feeWei: bigint;
  /** Slice 5 pattern-detection inputs (hashes only — output text never persists). */
  resultHash?: Hex;
  finishReason?: string;
}

/** A persisted job row, decoded back into typed fields. */
export interface JobRecord {
  jobId: Hex;
  requester: Address;
  provider: Address;
  model: string;
  status: JobStatus;
  maxTokens: number;
  actualTokens: number | null;
  agreedPriceWei: string;
  lockedWei: string;
  paymentWei: string | null;
  providerPayWei: string | null;
  feeWei: string | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Per-requester usage, aggregated from settled job rows. */
export interface UsageSummary {
  jobs: number;
  tokens: number;
  spentWei: string;
}

interface JobRow {
  job_id: string;
  requester: string;
  provider: string;
  model: string;
  status: string;
  max_tokens: number;
  actual_tokens: number | null;
  agreed_price_wei: string;
  locked_wei: string;
  payment_wei: string | null;
  provider_pay_wei: string | null;
  fee_wei: string | null;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

function decode(r: JobRow): JobRecord {
  return {
    jobId: r.job_id as Hex,
    requester: r.requester as Address,
    provider: r.provider as Address,
    model: r.model,
    status: r.status as JobStatus,
    maxTokens: r.max_tokens,
    actualTokens: r.actual_tokens,
    agreedPriceWei: r.agreed_price_wei,
    lockedWei: r.locked_wei,
    paymentWei: r.payment_wei,
    providerPayWei: r.provider_pay_wei,
    feeWei: r.fee_wei,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Persists the job lifecycle as a queryable mirror of the on-chain escrow. The chain stays
 * authoritative — these rows are a cache/index for `/v1/jobs` and `/v1/usage`. Usage is
 * derived by aggregating settled rows, so there's no second table to keep in sync.
 */
export class JobStore {
  constructor(private readonly db: GatewayDb) {}

  /** Record a job as locked + assigned (INSERT OR REPLACE — a retried jobId overwrites). */
  recordAssigned(j: AssignedJob): void {
    const now = Date.now();
    this.db.conn
      .prepare(
        `INSERT OR REPLACE INTO jobs(
           job_id, requester, provider, model, status, max_tokens,
           agreed_price_wei, locked_wei, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'assigned', ?, ?, ?, ?, ?)`,
      )
      .run(
        j.jobId,
        j.requester.toLowerCase(),
        j.provider.toLowerCase(),
        j.model,
        j.maxTokens,
        j.agreedPriceWei.toString(),
        j.lockedWei.toString(),
        now,
        now,
      );
  }

  markSettled(jobId: Hex, s: SettledJob): void {
    this.db.conn
      .prepare(
        `UPDATE jobs SET status='verified', actual_tokens=?, payment_wei=?,
           provider_pay_wei=?, fee_wei=?, result_hash=?, finish_reason=?, updated_at=?
         WHERE job_id=?`,
      )
      .run(
        s.actualTokens,
        s.paymentWei.toString(),
        s.providerPayWei.toString(),
        s.feeWei.toString(),
        s.resultHash ?? null,
        s.finishReason ?? null,
        Date.now(),
        jobId,
      );
  }

  /** Stamp the measured time-to-first-token (Slice 4 Latency telemetry). */
  recordFirstToken(jobId: Hex, firstTokenMs: number): void {
    this.db.conn
      .prepare(`UPDATE jobs SET first_token_ms=?, updated_at=? WHERE job_id=?`)
      .run(Math.round(firstTokenMs), Date.now(), jobId);
  }

  /** TTFT samples for a provider since `sinceMs` (the Latency dimension's P95 input). */
  firstTokenMsSince(provider: Address, sinceMs: number): number[] {
    const rows = this.db.conn
      .prepare(
        `SELECT first_token_ms FROM jobs
         WHERE provider=? AND created_at > ? AND first_token_ms IS NOT NULL`,
      )
      .all(provider.toLowerCase(), sinceMs) as { first_token_ms: number }[];
    return rows.map((r) => r.first_token_ms);
  }

  /** The provider that settled the FIRST verified job per model (Slice 6C
   *  first-model bonus attribution; ties broken by job_id for determinism). */
  firstProviderByModel(): Map<string, Address> {
    const rows = this.db.conn
      .prepare(
        `SELECT model, provider FROM jobs j
         WHERE status='verified' AND (created_at, job_id) = (
           SELECT j2.created_at, j2.job_id FROM jobs j2
           WHERE j2.model = j.model AND j2.status='verified'
           ORDER BY j2.created_at ASC, j2.job_id ASC LIMIT 1
         )`,
      )
      .all() as { model: string; provider: string }[];
    return new Map(rows.map((r) => [r.model, r.provider as Address]));
  }

  /** Jobs created in a window — the public status page's 24h activity number. */
  countSince(sinceMs: number): number {
    const row = this.db.conn
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE created_at > ?')
      .get(sinceMs) as { n: number };
    return row.n;
  }

  /** When the most recent job settled (ms), or undefined if none ever has. */
  lastSettledAt(): number | undefined {
    const row = this.db.conn
      .prepare(`SELECT MAX(updated_at) AS t FROM jobs WHERE status='verified'`)
      .get() as { t: number | null };
    return row.t ?? undefined;
  }

  markFailed(jobId: Hex, reason: string): void {
    this.db.conn
      .prepare(`UPDATE jobs SET status='failed', reason=?, updated_at=? WHERE job_id=?`)
      .run(reason, Date.now(), jobId);
  }

  get(jobId: Hex): JobRecord | undefined {
    const row = this.db.conn.prepare('SELECT * FROM jobs WHERE job_id=?').get(jobId) as
      | JobRow
      | undefined;
    return row ? decode(row) : undefined;
  }

  /** Aggregate a requester's settled jobs. wei is summed in JS (it overflows SQLite INTEGER). */
  usageFor(requester: Address): UsageSummary {
    const rows = this.db.conn
      .prepare(
        `SELECT actual_tokens, payment_wei FROM jobs WHERE requester=? AND status='verified'`,
      )
      .all(requester.toLowerCase()) as {
      actual_tokens: number | null;
      payment_wei: string | null;
    }[];
    let tokens = 0;
    let spent = 0n;
    for (const r of rows) {
      tokens += r.actual_tokens ?? 0;
      spent += BigInt(r.payment_wei ?? '0');
    }
    return { jobs: rows.length, tokens, spentWei: spent.toString() };
  }

  /**
   * Quota consumption over a rolling window (Slice 3): EVERY dispatched job counts toward
   * the job budget (failed attempts burn quota — the abuse deterrent), tokens as settled.
   */
  usageSince(requester: Address, sinceMs: number): { jobs: number; tokens: number } {
    const row = this.db.conn
      .prepare(
        `SELECT COUNT(*) AS jobs, COALESCE(SUM(COALESCE(actual_tokens, 0)), 0) AS tokens
         FROM jobs WHERE requester=? AND created_at > ?`,
      )
      .get(requester.toLowerCase(), sinceMs) as { jobs: number; tokens: number };
    return { jobs: row.jobs, tokens: row.tokens };
  }
}
