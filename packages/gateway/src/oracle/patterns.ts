import type { Address } from 'viem';
import type { Logger } from 'pino';
import type { GatewayDb } from '../db/index.js';
import type { NodeFlagStore } from '../db/node-flags.js';
import { metrics } from '../metrics.js';

/**
 * Pattern-based cheater detection (Slice 5, spec §6.2): statistically impossible output
 * histories flag a node regardless of any single job. Derived entirely from job rows
 * (no counter tables): jobId = hash of the canonical spec, so two jobs share a
 * result_hash only if a node returned IDENTICAL output for DIFFERENT requests — honest
 * inference effectively never does that; caches do. Always-`length`-truncation across
 * a whole history is the "always truncated at exactly N tokens" tell.
 * Flags are manual-review only — no slash, no chain effect.
 */

/** Distinct jobs sharing one result_hash before we call it a caching cheater. */
export const DUPLICATE_OUTPUT_THRESHOLD = 3;
/** Minimum verified jobs before the truncation ratio is meaningful. */
export const TRUNCATION_MIN_JOBS = 10;
/** Fraction of jobs finishing 'length' that flags (1.0 = literally every job). */
export const TRUNCATION_RATIO = 0.95;

export interface PatternRow {
  resultHash: string | null;
  finishReason: string | null;
}

/** result_hash values that repeat across ≥ threshold distinct jobs. */
export function detectDuplicateOutputs(
  rows: readonly PatternRow[],
  threshold = DUPLICATE_OUTPUT_THRESHOLD,
): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.resultHash) continue;
    counts.set(r.resultHash, (counts.get(r.resultHash) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= threshold).map(([hash]) => hash);
}

/** True when (nearly) every job in a sufficiently long history truncated at length. */
export function detectTruncationPattern(
  rows: readonly PatternRow[],
  minJobs = TRUNCATION_MIN_JOBS,
  ratio = TRUNCATION_RATIO,
): boolean {
  const withReason = rows.filter((r) => r.finishReason !== null);
  if (withReason.length < minJobs) return false;
  const truncated = withReason.filter((r) => r.finishReason === 'length').length;
  return truncated / withReason.length >= ratio;
}

/** Rolling window the sweep inspects (spec §6.3: 7 days). */
export const PATTERN_WINDOW_MS = 7 * 86_400_000;

/**
 * Periodic sweep over each provider's recent verified jobs. Re-flagging is suppressed
 * while an identical flag from the current window already exists (one human to-do per
 * ongoing pattern, not one per sweep).
 */
export class PatternDetector {
  constructor(
    private readonly db: GatewayDb,
    private readonly flags: NodeFlagStore,
    private readonly logger: Logger,
  ) {}

  scanAll(): void {
    const sinceMs = Date.now() - PATTERN_WINDOW_MS;
    const providers = (
      this.db.conn
        .prepare(`SELECT DISTINCT provider FROM jobs WHERE created_at > ? AND status='verified'`)
        .all(sinceMs) as { provider: string }[]
    ).map((r) => r.provider as Address);

    for (const provider of providers) {
      const rows = (
        this.db.conn
          .prepare(
            `SELECT result_hash, finish_reason FROM jobs
             WHERE provider=? AND created_at > ? AND status='verified'`,
          )
          .all(provider, sinceMs) as { result_hash: string | null; finish_reason: string | null }[]
      ).map((r) => ({ resultHash: r.result_hash, finishReason: r.finish_reason }));

      const duplicates = detectDuplicateOutputs(rows);
      if (duplicates.length > 0) {
        this.flag(
          provider,
          'pattern:duplicate-output',
          `identical output for ${String(duplicates.length)} hash(es) across distinct prompts`,
          sinceMs,
        );
      }
      if (detectTruncationPattern(rows)) {
        this.flag(provider, 'pattern:truncation', 'every recent job truncated at length', sinceMs);
      }
    }
  }

  private flag(
    wallet: Address,
    kind: 'pattern:duplicate-output' | 'pattern:truncation',
    detail: string,
    windowStartMs: number,
  ): void {
    const existing = this.flags.latestOfKind(wallet, kind);
    if (existing && existing.createdAt > windowStartMs) return; // already on the review list
    this.flags.add(wallet, kind, detail);
    metrics.patternFlags += 1;
    this.logger.warn(
      { wallet, kind, detail },
      'output-pattern cheater signal — flagged for manual review',
    );
  }
}
