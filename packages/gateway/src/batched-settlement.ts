import type { Logger } from 'pino';
import type { Address, Hex } from 'viem';
import type { ChainClient, SignedCap } from './chain-client.js';
import type { SessionStore } from './db/sessions.js';
import type { DebitLedgerStore } from './db/ledger.js';
import {
  emaReputationBps,
  FAIL_ALPHA,
  PASS_ALPHA,
  SLASH_BPS,
  type Settlement,
  type SettlementContext,
} from './settlement.js';

export interface BatchedSettlementOptions {
  /** Flush a requester's pending debits once this many have accumulated. */
  flushThreshold: number;
}

/**
 * Batched, session-deposit settlement (Slice 2). Instead of an on-chain tx per job, `settle`
 * records a signed debit in the durable ledger; once a requester accumulates `flushThreshold`
 * debits (or on `flushAll` at shutdown) it settles them all in ONE `CreditAccount.batchSettle`
 * tx, bounded by the requester's signed cap. The requester signs nothing per call.
 *
 * Reputation is updated once per provider per flush (not per job), in keeping with the batched
 * philosophy; the full multi-dimensional, snapshotted reputation is Slice 4.
 */
export class BatchedSettlement implements Settlement {
  private readonly flushing = new Set<string>();

  constructor(
    private readonly chain: ChainClient,
    private readonly sessions: SessionStore,
    private readonly ledger: DebitLedgerStore,
    private readonly logger: Logger,
    private readonly opts: BatchedSettlementOptions,
  ) {}

  async settle(ctx: SettlementContext): Promise<void> {
    if (ctx.paymentWei === undefined) {
      throw new Error('BatchedSettlement.settle requires paymentWei');
    }
    this.ledger.record({
      jobId: ctx.jobId,
      requester: ctx.requester,
      provider: ctx.provider,
      amountWei: ctx.paymentWei,
      tokens: ctx.authoritativeTokens,
    });
    if (this.ledger.pending(ctx.requester).length >= this.opts.flushThreshold) {
      await this.flush(ctx.requester);
    }
  }

  async fail(jobId: Hex, reason: string, provider?: Address): Promise<void> {
    // No payment is owed for a failed job, so nothing is debited. Still penalize the
    // provider (the job never touched JobEscrow, so the caller supplies the provider).
    if (provider) {
      const node = await this.chain.getNode(provider);
      const newScore = emaReputationBps(Number(node.reputationScore), 0, FAIL_ALPHA);
      await this.chain.updateReputation(provider, newScore);
      const slashAmount = (node.stakeAmount * SLASH_BPS) / 10000n;
      if (slashAmount > 0n) {
        await this.chain.slash(provider, slashAmount, reason);
        this.logger.warn(
          { provider, slashAmount: slashAmount.toString() },
          'provider slashed (batched)',
        );
      }
    }
    this.logger.warn({ jobId, reason }, 'batched job failed (no debit owed)');
  }

  /** Settle all of a requester's pending debits in one on-chain batchSettle tx. */
  async flush(requester: Address): Promise<void> {
    const key = requester.toLowerCase();
    if (this.flushing.has(key)) return; // a flush is already in flight for this requester
    this.flushing.add(key);
    try {
      const debits = this.ledger.pending(requester);
      if (debits.length === 0) return;

      const nowSeconds = Math.floor(Date.now() / 1000);
      const session = this.sessions.getActive(requester, nowSeconds);
      if (!session) {
        this.logger.error(
          { requester, pending: debits.length },
          'no active credit session to flush against — debits left pending',
        );
        return;
      }

      const cap: SignedCap = {
        requester: session.requester,
        settler: session.settler,
        maxSpendWei: session.maxSpendWei,
        nonce: session.nonce,
        deadline: session.deadline,
        signature: session.signature,
      };
      const hash = await this.chain.batchSettle(
        cap,
        debits.map((d) => ({ jobId: d.jobId, provider: d.provider, amountWei: d.amountWei })),
      );
      this.ledger.markBatched(
        debits.map((d) => d.jobId),
        hash,
      );

      // One reputation update per distinct provider in the batch (a verified pass each).
      const counts = new Map<Address, number>();
      for (const d of debits) counts.set(d.provider, (counts.get(d.provider) ?? 0) + 1);
      for (const [provider, count] of counts) {
        const node = await this.chain.getNode(provider);
        let score = Number(node.reputationScore);
        for (let i = 0; i < count; i++) score = emaReputationBps(score, 1, PASS_ALPHA);
        await this.chain.updateReputation(provider, score);
      }

      this.logger.info(
        { requester, jobs: debits.length, providers: counts.size, settleTx: hash },
        'batch settled on-chain',
      );
    } finally {
      this.flushing.delete(key);
    }
  }

  /** Flush every requester with pending debits (timer / graceful shutdown). */
  async flushAll(): Promise<void> {
    for (const requester of this.ledger.requestersWithPending()) {
      try {
        await this.flush(requester);
      } catch (err) {
        this.logger.error({ err, requester }, 'flushAll: batch settle failed');
      }
    }
  }
}
