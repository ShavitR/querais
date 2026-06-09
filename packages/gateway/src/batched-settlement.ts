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
  /** Flush early once the session cap's deadline is within this many seconds — debits
   *  left pending past the deadline can never settle (the contract reverts CapExpired). */
  deadlineMarginSeconds: number;
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
    // Flush on threshold, or early when the cap's deadline is close (a debit that misses
    // the deadline can never settle). A flush failure is NOT this request's failure: the
    // debit is durably recorded and retries on the next trigger (threshold/timer/shutdown).
    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = this.sessions.getActive(ctx.requester, nowSeconds);
    const nearDeadline =
      session !== undefined &&
      Number(session.deadline) - nowSeconds <= this.opts.deadlineMarginSeconds;
    if (nearDeadline || this.ledger.pending(ctx.requester).length >= this.opts.flushThreshold) {
      try {
        await this.flush(ctx.requester);
      } catch (err) {
        this.logger.error({ err, requester: ctx.requester }, 'flush failed (debits retained)');
      }
    }
  }

  /**
   * Whether the requester's session can absorb `worstCaseWei` more debt without the
   * eventual batchSettle reverting: on-chain spent + off-chain pending + the new job's
   * worst case must fit under both the signed cap and the deposited balance. The chain
   * enforces the same bounds — this check just keeps the gateway from accepting work
   * it could never settle (providers would serve inference for nothing).
   */
  async canAccrue(requester: Address, worstCaseWei: bigint): Promise<boolean> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = this.sessions.getActive(requester, nowSeconds);
    if (!session) return false;
    const pendingSum = this.ledger.pending(requester).reduce((sum, d) => sum + d.amountWei, 0n);
    const [spent, balance] = await Promise.all([
      this.chain.spentAgainst(requester, session.nonce),
      this.chain.creditBalance(requester),
    ]);
    return (
      spent + pendingSum + worstCaseWei <= session.maxSpendWei &&
      pendingSum + worstCaseWei <= balance
    );
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
      let hash: Hex;
      try {
        hash = await this.chain.batchSettle(
          cap,
          debits.map((d) => ({ jobId: d.jobId, provider: d.provider, amountWei: d.amountWei })),
        );
      } catch (err) {
        // The whole batch reverts if ANY debit was already settled on-chain (e.g. a crash
        // landed between tx-send and markBatched). Reconcile against the contract's
        // settledJob guard so stale debits can't wedge the ledger forever, then rethrow.
        await this.reconcile(requester, debits);
        throw err;
      }
      this.ledger.markBatched(
        debits.map((d) => d.jobId),
        hash,
      );

      // One reputation update per distinct provider in the batch (a verified pass each).
      // Money has already moved and the ledger is stamped — a registry hiccup here must
      // not surface as a flush failure.
      const counts = new Map<Address, number>();
      for (const d of debits) counts.set(d.provider, (counts.get(d.provider) ?? 0) + 1);
      try {
        for (const [provider, count] of counts) {
          const node = await this.chain.getNode(provider);
          let score = Number(node.reputationScore);
          for (let i = 0; i < count; i++) score = emaReputationBps(score, 1, PASS_ALPHA);
          await this.chain.updateReputation(provider, score);
        }
      } catch (err) {
        this.logger.warn({ err, requester }, 'post-flush reputation update failed (non-fatal)');
      }

      this.logger.info(
        { requester, jobs: debits.length, providers: counts.size, settleTx: hash },
        'batch settled on-chain',
      );
    } finally {
      this.flushing.delete(key);
    }
  }

  /**
   * Drop pending debits the chain says are already settled (stamped with a `recovered:*`
   * sentinel instead of a tx hash). Without this, one already-settled jobId reverts every
   * future batch and the requester's ledger is stuck permanently.
   */
  private async reconcile(requester: Address, debits: readonly { jobId: Hex }[]): Promise<void> {
    try {
      const settled: Hex[] = [];
      for (const d of debits) {
        if (await this.chain.settledJob(d.jobId)) settled.push(d.jobId);
      }
      if (settled.length > 0) {
        this.ledger.markBatched(settled, `recovered:${Date.now()}`);
        this.logger.warn(
          { requester, recovered: settled.length },
          'reconciled debits already settled on-chain (crash between settle and markBatched)',
        );
      }
    } catch (err) {
      this.logger.error({ err, requester }, 'ledger reconciliation failed');
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
