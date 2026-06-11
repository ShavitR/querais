import type { Address, Hex } from 'viem';
import type { GatewayDb } from './index.js';

export type LayerAVerdict = 'pass' | 'soft' | 'anomaly';

/** One Layer-A semantic-sampling verdict (Slice 5). */
export interface LayerACheck {
  jobId: Hex;
  provider: Address;
  /** Max cosine similarity vs the oracle re-runs, in bps of [0,1]. */
  similarityBps: number;
  verdict: LayerAVerdict;
  oracleRuns: number;
  createdAt: number;
}

interface CheckRow {
  job_id: string;
  provider: string;
  similarity_bps: number;
  verdict: string;
  oracle_runs: number;
  created_at: number;
}

function decode(r: CheckRow): LayerACheck {
  return {
    jobId: r.job_id as Hex,
    provider: r.provider as Address,
    similarityBps: r.similarity_bps,
    verdict: r.verdict as LayerAVerdict,
    oracleRuns: r.oracle_runs,
    createdAt: r.created_at,
  };
}

/**
 * Persisted Layer-A verdicts — the oracle's audit trail ("which jobs were sampled, what
 * did the similarity say"). Verdicts only; sampled prompt/output text never touches the
 * DB (prompt privacy).
 */
export class LayerACheckStore {
  constructor(private readonly db: GatewayDb) {}

  insert(c: LayerACheck): void {
    this.db.conn
      .prepare(
        `INSERT OR REPLACE INTO layer_a_checks(
           job_id, provider, similarity_bps, verdict, oracle_runs, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.jobId,
        c.provider.toLowerCase(),
        c.similarityBps,
        c.verdict,
        c.oracleRuns,
        c.createdAt,
      );
  }

  get(jobId: Hex): LayerACheck | undefined {
    const row = this.db.conn.prepare(`SELECT * FROM layer_a_checks WHERE job_id=?`).get(jobId) as
      | CheckRow
      | undefined;
    return row ? decode(row) : undefined;
  }

  forProviderSince(provider: Address, sinceMs: number): LayerACheck[] {
    const rows = this.db.conn
      .prepare(`SELECT * FROM layer_a_checks WHERE provider=? AND created_at > ?`)
      .all(provider.toLowerCase(), sinceMs) as unknown as CheckRow[];
    return rows.map(decode);
  }
}
