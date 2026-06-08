import { zeroAddress, type Address, type Hex } from 'viem';
import type { Logger } from 'pino';
import type { ChainClient } from './chain-client.js';

/**
 * Settlement seam. The dispatcher calls this after Layer-B verification.
 *  - NoopSettlement leaves the job ASSIGNED on-chain (used by tests that don't care
 *    about money movement).
 *  - ChainSettlement closes the loop: completeJob → verifyAndRelease (pay 95% / 5% /
 *    refund) and updates the provider's reputation via EMA; failJob refunds on failure.
 */
export interface SettlementContext {
  jobId: Hex;
  provider: Address;
  requester: Address;
  authoritativeTokens: number;
  resultHash: Hex;
}

export interface Settlement {
  settle(ctx: SettlementContext): Promise<void>;
  fail(jobId: Hex, reason: string): Promise<void>;
}

/** No-op settlement (records nothing on-chain). */
export class NoopSettlement implements Settlement {
  async settle(): Promise<void> {}
  async fail(): Promise<void> {}
}

// Reputation EMA tuning (mirrors the reputation-system design's accuracy EMA).
const PASS_ALPHA = 0.005; // slow-moving on a verified pass
const FAIL_ALPHA = 0.05; // 10× faster on an anomaly/failure

// Economic penalty: slash this fraction (basis points) of a node's stake when it
// returns a verified-bad result. Small per-incident; staking is the real deterrent.
const SLASH_BPS = 100n; // 1%

/** EMA update in basis points: next = current·(1-α) + outcome·10000·α, clamped. */
export function emaReputationBps(currentBps: number, outcome01: number, alpha: number): number {
  const next = currentBps * (1 - alpha) + outcome01 * 10000 * alpha;
  return Math.max(0, Math.min(10000, Math.round(next)));
}

/** Chain-backed settlement: the real money + reputation movement. */
export class ChainSettlement implements Settlement {
  constructor(
    private readonly chain: ChainClient,
    private readonly logger: Logger,
  ) {}

  async settle(ctx: SettlementContext): Promise<void> {
    await this.chain.completeJob(ctx.jobId, BigInt(ctx.authoritativeTokens), ctx.resultHash);
    await this.chain.verifyAndRelease(ctx.jobId);

    // Reward a verified pass with a small reputation bump.
    const node = await this.chain.getNode(ctx.provider);
    const newScore = emaReputationBps(Number(node.reputationScore), 1, PASS_ALPHA);
    await this.chain.updateReputation(ctx.provider, newScore);

    this.logger.info({ jobId: ctx.jobId, provider: ctx.provider, newScore }, 'job settled');
  }

  async fail(jobId: Hex, reason: string): Promise<void> {
    const job = await this.chain.getJob(jobId);
    await this.chain.failJob(jobId, reason);

    // Penalize the provider on a failure: reputation EMA down + a small stake slash.
    if (job.provider !== zeroAddress) {
      const node = await this.chain.getNode(job.provider);
      const newScore = emaReputationBps(Number(node.reputationScore), 0, FAIL_ALPHA);
      await this.chain.updateReputation(job.provider, newScore);

      const slashAmount = (node.stakeAmount * SLASH_BPS) / 10000n;
      if (slashAmount > 0n) {
        await this.chain.slash(job.provider, slashAmount, reason);
        this.logger.warn(
          { provider: job.provider, slashAmount: slashAmount.toString() },
          'provider slashed',
        );
      }
    }
    this.logger.warn({ jobId, reason }, 'job failed + refunded');
  }
}
