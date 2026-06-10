import { zeroAddress, type Address, type Hex } from 'viem';
import type { Logger } from 'pino';
import type { ChainClient } from './chain-client.js';
import { emaReputationBps, FAIL_ALPHA, PASS_ALPHA } from './reputation.js';

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
  /** Gross payment owed (agreedPrice·tokens). Used by BatchedSettlement; ChainSettlement
   *  recomputes from on-chain state and ignores it. */
  paymentWei?: bigint;
}

export interface Settlement {
  settle(ctx: SettlementContext): Promise<void>;
  /** `provider` lets venues without an on-chain job (batched) still penalize the node;
   *  ChainSettlement reads the provider from the escrow and ignores it. */
  fail(jobId: Hex, reason: string, provider?: Address): Promise<void>;
}

/** No-op settlement (records nothing on-chain). */
export class NoopSettlement implements Settlement {
  async settle(): Promise<void> {}
  async fail(): Promise<void> {}
}

// Economic penalty: slash this fraction (basis points) of a node's stake when it
// returns a verified-bad result. Small per-incident; staking is the real deterrent.
export const SLASH_BPS = 100n; // 1%

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
