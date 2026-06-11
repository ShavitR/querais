import type { Address } from 'viem';
import type { Logger } from 'pino';
import type { ChainClient } from './chain-client.js';
import type { JobStore } from './db/jobs.js';
import type { NodeReputationStore } from './db/node-reputation.js';
import type { NodeSessionStore, SessionInterval } from './db/node-sessions.js';
import type { ReputationSnapshotStore } from './db/reputation-snapshots.js';
import { metrics } from './metrics.js';

/**
 * Slice 4 — the full 5-dimension reputation from querais_reputation_system.md §2:
 *
 *   Composite = 0.40·Accuracy + 0.25·Uptime + 0.15·Latency + 0.10·Longevity + 0.10·Stake
 *
 * All scores are integers in basis points of [0,1] (10000 == 1.0), matching the
 * on-chain uint16. Dimension state is gateway-side oracle working state (the spec's
 * own off-chain model); the chain keeps the single published composite. The pure
 * functions here are the unit-testable boundaries; ReputationService composes them
 * over the stores + chain reads.
 */

// Accuracy EMA tuning (moved from settlement.ts; mirrors the spec's accuracy EMA).
export const PASS_ALPHA = 0.005; // slow-moving on a verified pass (~200-job half-life)
export const FAIL_ALPHA = 0.05; // 10× faster on an anomaly/failure
export const SOFT_FAIL_ALPHA = 0.005; // Layer-A soft signal (standard-fail speed, spec §2.2A)

/** Accuracy a node starts from (the spec's onboarding baseline; NodeRegistry's
 *  INITIAL_REPUTATION). Never seeded from the on-chain score — after 4B that score is
 *  the composite, and seeding accuracy from it would double-count other dimensions. */
export const INITIAL_ACCURACY_BPS = 7000;

/** Composite weights in bps (sum to 10000). */
export const WEIGHTS_BPS = {
  accuracy: 4000,
  uptime: 2500,
  latency: 1500,
  longevity: 1000,
  stake: 1000,
} as const;

/** StakeScore saturates at the Platinum threshold (10,000 QAIS). */
export const PLATINUM_STAKE_WEI = 10_000n * 10n ** 18n;

/** Rolling window for the Uptime and Latency dimensions (spec: last 30 days). */
export const TELEMETRY_WINDOW_MS = 30 * 86_400_000;

/** Longevity only starts decaying after this many days of inactivity (spec: >30d). */
export const INACTIVITY_GRACE_DAYS = 30;

/** Rapid-decline detection (spec §2.2A safety rules): a composite drop bigger than
 *  this, against any snapshot in the trailing window, flags the node for MANUAL
 *  review — log + metric + DB flag only, deliberately no auto-slash or chain effect. */
export const RAPID_DECLINE_DROP_BPS = 2000;
export const RAPID_DECLINE_WINDOW_MS = 7 * 86_400_000;

const DAY_MS = 86_400_000;

/** EMA update in basis points: next = current·(1-α) + outcome·10000·α, clamped. */
export function emaReputationBps(currentBps: number, outcome01: number, alpha: number): number {
  const next = currentBps * (1 - alpha) + outcome01 * 10000 * alpha;
  return Math.max(0, Math.min(10000, Math.round(next)));
}

/** P95 of a sample set (nearest-rank), or undefined when there are no samples. */
export function p95(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/**
 * Latency dimension from the P95 time-to-first-token (spec §2.2C grade thresholds).
 * No samples yet → 1.0: an unmeasured node gets the benefit of the doubt and is
 * graded from its very first job.
 */
export function latencyGradeBps(p95Ms: number | undefined): number {
  if (p95Ms === undefined) return 10000;
  if (p95Ms < 500) return 10000;
  if (p95Ms < 1000) return 9000;
  if (p95Ms < 2000) return 7500;
  if (p95Ms < 5000) return 5000;
  return 2500;
}

/**
 * Uptime dimension: observed-connected time over the window, as a fraction of the
 * time since the node was first seen within it (a node that registered mid-window
 * isn't penalized for time before it existed). No sessions at all → 1.0 (a node is
 * measured from its first connection).
 */
export function uptimeRatioBps(
  intervals: readonly SessionInterval[],
  windowStartMs: number,
  nowMs: number,
): number {
  if (intervals.length === 0) return 10000;
  let firstSeen = Infinity;
  let connected = 0;
  for (const iv of intervals) {
    firstSeen = Math.min(firstSeen, iv.start);
    const start = Math.max(iv.start, windowStartMs);
    const end = Math.min(iv.end ?? nowMs, nowMs);
    if (end > start) connected += end - start;
  }
  const observedStart = Math.max(windowStartMs, firstSeen);
  const observed = nowMs - observedStart;
  if (observed <= 0) return 10000;
  return Math.max(0, Math.min(10000, Math.round((connected / observed) * 10000)));
}

/**
 * Longevity dimension: min(1, activeDays/365) from the on-chain registeredAt, decaying
 * once the node has been inactive past the 30-day grace — linearly to zero over a
 * further 365 days (the spec mandates decay after 30d; the curve is ours).
 */
export function longevityScoreBps(
  registeredAtSec: number,
  lastActiveMs: number,
  nowMs: number,
): number {
  if (registeredAtSec <= 0) return 0;
  const activeDays = (nowMs - registeredAtSec * 1000) / DAY_MS;
  if (activeDays <= 0) return 0;
  const base = Math.min(1, activeDays / 365);
  const inactiveDays = (nowMs - lastActiveMs) / DAY_MS;
  const decay =
    inactiveDays > INACTIVITY_GRACE_DAYS
      ? Math.max(0, 1 - (inactiveDays - INACTIVITY_GRACE_DAYS) / 365)
      : 1;
  return Math.max(0, Math.min(10000, Math.round(base * decay * 10000)));
}

/** Stake dimension: min(1, stake / 10,000 QAIS), integer math on wei. */
export function stakeScoreBps(stakeWei: bigint): number {
  if (stakeWei <= 0n) return 0;
  const bps = (stakeWei * 10000n) / PLATINUM_STAKE_WEI;
  return bps >= 10000n ? 10000 : Number(bps);
}

export interface DimensionScores {
  accuracyBps: number;
  uptimeBps: number;
  latencyBps: number;
  longevityBps: number;
  stakeBps: number;
}

export interface ReputationDimensions extends DimensionScores {
  compositeBps: number;
}

/** Weighted composite over the five dimensions, rounded + clamped to uint16 bps. */
export function compositeBps(d: DimensionScores): number {
  const sum =
    WEIGHTS_BPS.accuracy * d.accuracyBps +
    WEIGHTS_BPS.uptime * d.uptimeBps +
    WEIGHTS_BPS.latency * d.latencyBps +
    WEIGHTS_BPS.longevity * d.longevityBps +
    WEIGHTS_BPS.stake * d.stakeBps;
  return Math.max(0, Math.min(10000, Math.round(sum / 10000)));
}

/** The chain fields the dimensions need (a subset of NodeRegistry.getNode's struct). */
interface NodeChainInfo {
  registeredAt: bigint;
  stakeAmount: bigint;
  /** When present and false, the node is gone from the registry (publish would revert). */
  exists?: boolean;
}

/**
 * The reputation oracle's working state: accumulates per-job outcomes into the
 * accuracy EMA and derives the other four dimensions from telemetry (job rows,
 * session intervals) + chain reads. Publishing the composite on-chain is the
 * snapshot machinery's job (4B) — this service only computes.
 */
export class ReputationService {
  constructor(
    private readonly chain: ChainClient,
    private readonly accuracy: NodeReputationStore,
    private readonly sessions: NodeSessionStore,
    private readonly jobs: JobStore,
    private readonly snapshots: ReputationSnapshotStore,
    private readonly logger: Logger,
  ) {}

  /**
   * Fold a verified job outcome into the provider's accuracy EMA. The dispatcher
   * records pass/fail (it knows provider + verdict for both settlement venues);
   * the Layer-A sampler records the oracle outcomes (Slice 5, spec §2.2A alphas:
   * oracle-flagged anomaly moves 10× faster than a soft signal). Returns the new
   * accuracy in bps.
   */
  recordOutcome(
    provider: Address,
    outcome: 'pass' | 'fail' | 'oracle-anomaly' | 'oracle-soft',
  ): number {
    const current = this.accuracy.get(provider)?.accuracyBps ?? INITIAL_ACCURACY_BPS;
    const next =
      outcome === 'pass'
        ? emaReputationBps(current, 1, PASS_ALPHA)
        : emaReputationBps(current, 0, outcome === 'oracle-soft' ? SOFT_FAIL_ALPHA : FAIL_ALPHA);
    this.accuracy.set(provider, next);
    if (outcome !== 'pass') {
      this.logger.warn({ provider, outcome, accuracyBps: next }, 'accuracy EMA penalized');
    }
    return next;
  }

  /**
   * Compute all five dimensions + the composite for a node. Pass the already-fetched
   * NodeRegistry struct to skip the chain read (the pool has it in hand on hello).
   */
  async dimensionsFor(wallet: Address, node?: NodeChainInfo): Promise<ReputationDimensions> {
    const info = node ?? (await this.chain.getNode(wallet));
    const nowMs = Date.now();
    const windowStartMs = nowMs - TELEMETRY_WINDOW_MS;

    const accuracyBps = this.accuracy.get(wallet)?.accuracyBps ?? INITIAL_ACCURACY_BPS;
    const intervals = this.sessions.intervalsSince(wallet, windowStartMs);
    const uptimeBps = uptimeRatioBps(intervals, windowStartMs, nowMs);
    const latencyBps = latencyGradeBps(p95(this.jobs.firstTokenMsSince(wallet, windowStartMs)));
    const lastActiveMs = this.sessions.lastActive(wallet) ?? nowMs;
    const longevityBps = longevityScoreBps(Number(info.registeredAt), lastActiveMs, nowMs);
    const stakeBps = stakeScoreBps(info.stakeAmount);

    const dims: DimensionScores = { accuracyBps, uptimeBps, latencyBps, longevityBps, stakeBps };
    return { ...dims, compositeBps: compositeBps(dims) };
  }

  /** The composite alone (what the pool feeds matching and the chain will publish). */
  async compositeFor(wallet: Address, node?: NodeChainInfo): Promise<number> {
    return (await this.dimensionsFor(wallet, node)).compositeBps;
  }

  /**
   * Publish a node's composite on-chain NOW (receipt-checked by ChainClient) and
   * record the snapshot row, running rapid-decline detection against the trailing
   * window. Used by the daily snapshot sweep and the immediate post-slash publish.
   * Returns undefined when the node is gone from the registry (publish would revert).
   */
  async publishNow(wallet: Address): Promise<ReputationDimensions | undefined> {
    const info = await this.chain.getNode(wallet);
    if (info.exists === false) {
      this.logger.warn({ wallet }, 'skipping reputation publish: node not in registry');
      return undefined;
    }
    const dims = await this.dimensionsFor(wallet, info);
    const txHash = await this.chain.updateReputation(wallet, dims.compositeBps);

    // Rapid decline (spec safety rule): drop > 2000 bps vs any snapshot in the last
    // 7 days → flag for MANUAL review. Log + metric + DB flag; no auto-slash, no
    // chain effect — a human decides.
    const priorMax = this.snapshots.maxCompositeSince(wallet, Date.now() - RAPID_DECLINE_WINDOW_MS);
    const flagged = priorMax !== undefined && priorMax - dims.compositeBps > RAPID_DECLINE_DROP_BPS;
    if (flagged) {
      metrics.reputationFlags += 1;
      this.logger.warn(
        { wallet, priorMax, compositeBps: dims.compositeBps },
        'rapid reputation decline — node flagged for manual review',
      );
    }

    this.snapshots.insert({ wallet, ...dims, txHash, flagged, createdAt: Date.now() });
    metrics.reputationSnapshots += 1;
    this.logger.info({ wallet, compositeBps: dims.compositeBps, txHash }, 'reputation published');
    return dims;
  }

  /**
   * The daily epoch sweep: publish every known node's composite. A node is "known" if
   * it ever connected or has accuracy state. Per-node failures are isolated — one bad
   * publish must not starve the rest of the sweep.
   */
  async snapshotAll(): Promise<void> {
    const wallets = new Set<Address>([...this.sessions.wallets(), ...this.accuracy.wallets()]);
    for (const wallet of wallets) {
      try {
        await this.publishNow(wallet);
      } catch (err) {
        metrics.reputationPublishFailures += 1;
        this.logger.error({ err, wallet }, 'reputation snapshot publish failed');
      }
    }
  }
}
