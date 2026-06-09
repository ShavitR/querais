import type { Logger } from 'pino';
import type { Address, Hex } from 'viem';
import {
  identify,
  paymentFor,
  per1kQaisToWeiPerToken,
  splitPayment,
  JobTimeoutError,
  NoEligibleNodesError,
  VerificationError,
  type ChatCompletionRequest,
  type ChatMessage,
  type CompletionReport,
  type FinishReason,
  type JobAssignment,
} from '@querais/shared';
import { selectBest } from '@querais/matching';
import type { GatewayConfig } from './config.js';
import type { ChainClient } from './chain-client.js';
import type { NodePool } from './node-pool.js';
import type { Settlement } from './settlement.js';
import type { JobStore } from './db/jobs.js';
import type { SessionStore } from './db/sessions.js';
import type { BatchedSettlement } from './batched-settlement.js';
import { layerBVerify } from './verify.js';
import { metrics } from './metrics.js';

export interface DispatchResult {
  jobId: Hex;
  provider: Address;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: FinishReason;
}

interface StreamedJob {
  content: string;
  tokenCount: number;
  report: CompletionReport;
}

/**
 * Orchestrates a single inference request end-to-end: normalize → match → lock &
 * assign on-chain → proxy the token stream → Layer-B verify → settle. This is where
 * the off-chain matching meets the on-chain escrow; it is the only chain writer path
 * for jobs. `onToken` lets the HTTP layer stream deltas to the requester (SSE).
 */
export class Dispatcher {
  constructor(
    private readonly config: GatewayConfig,
    private readonly chain: ChainClient,
    private readonly pool: NodePool,
    private readonly settlement: Settlement,
    private readonly jobs: JobStore,
    private readonly logger: Logger,
    /** Slice 2: when a requester has an active credit session, settle off-chain via
     *  the ledger + batched CreditAccount.batchSettle instead of the per-job escrow path. */
    private readonly sessions?: SessionStore,
    private readonly credit?: BatchedSettlement,
  ) {}

  /**
   * Persist a job-record side effect without ever breaking the request. The DB is a thin
   * mirror of the on-chain truth, so a storage hiccup must not fail (or unsettle) a paid job.
   */
  private persist(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.warn({ err }, 'job persistence failed (non-fatal)');
    }
  }

  async dispatch(
    req: ChatCompletionRequest,
    requester: Address,
    onToken?: (delta: string) => void,
  ): Promise<DispatchResult> {
    // Base the deadline on CHAIN time, not wall-clock — block.timestamp can drift
    // (e.g. Hardhat bumps it +1s per block under bursty load), and on-chain createJob
    // checks `deadline > block.timestamp`.
    const now = Math.floor(Date.now() / 1000);
    const chainNow = Number(await this.chain.latestBlockTimestamp());
    const maxTokens = req.max_tokens ?? this.config.defaultMaxTokens;
    const maxPricePerTokenWei =
      req.max_price_per_1k_tokens != null
        ? per1kQaisToWeiPerToken(req.max_price_per_1k_tokens)
        : this.config.defaultMaxPricePerTokenWei;
    const minReputation =
      req.min_reputation != null
        ? Math.round(req.min_reputation * 10000)
        : this.config.defaultMinReputation;

    const messages: ChatMessage[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    const spec = identify({
      model: req.model,
      messages,
      maxTokens,
      temperature: req.temperature ?? 0.7,
      stream: req.stream ?? false,
      requesterWallet: requester,
      maxPricePerTokenWei: maxPricePerTokenWei.toString(),
      minReputation,
      createdAt: now,
      deadline: chainNow + this.config.jobDeadlineSeconds,
    });

    // ── Match ──
    const chosen = selectBest(this.pool.offers(), {
      model: spec.model,
      maxPricePerTokenWei,
      minReputation,
    });
    if (!chosen) throw new NoEligibleNodesError(`No eligible node can serve "${spec.model}"`);
    const provider = chosen.offer.wallet;
    const agreedPrice = chosen.offer.pricePerTokenWei;

    // ── Choose the settlement venue ──
    // A requester with an active, signed credit session settles off-chain via the batched
    // CreditAccount (zero per-call wallet txs); everyone else uses the per-job JobEscrow path.
    const batched = !!(this.credit && this.sessions?.getActive(requester, chainNow));

    // ── Lock + assign ──
    if (batched) {
      // No on-chain createJob/assignJob: the deposit + signed cap are the collateral.
      this.logger.info(
        { jobId: spec.jobId, provider, model: spec.model },
        'job assigned (batched, off-chain)',
      );
    } else {
      await this.chain.createJob(
        spec.jobId,
        requester,
        maxPricePerTokenWei,
        BigInt(maxTokens),
        BigInt(spec.deadline),
      );
      await this.chain.assignJob(spec.jobId, provider, agreedPrice);
      this.logger.info(
        { jobId: spec.jobId, provider, model: spec.model },
        'job created & assigned',
      );
    }
    metrics.jobsCreated += 1;
    this.persist(() =>
      this.jobs.recordAssigned({
        jobId: spec.jobId,
        requester,
        provider,
        model: spec.model,
        maxTokens,
        agreedPriceWei: agreedPrice,
        lockedWei: maxPricePerTokenWei * BigInt(maxTokens),
      }),
    );

    // ── Stream from the node ──
    const streamed = await this.runJob(spec, agreedPrice, provider, onToken);

    // ── Layer-B verify ──
    const verdict = layerBVerify({
      forwardedText: streamed.content,
      gatewayTokenCount: streamed.tokenCount,
      report: streamed.report,
      maxTokens,
    });
    const settlement: Settlement = batched && this.credit ? this.credit : this.settlement;
    if (!verdict.ok) {
      metrics.jobsFailed += 1;
      const reason = verdict.reason ?? 'verification failed';
      await settlement.fail(spec.jobId, reason, provider);
      this.persist(() => this.jobs.markFailed(spec.jobId, reason));
      throw new VerificationError(reason);
    }

    // ── Settle: escrow per-job, or accrue a signed debit for the next batch ──
    const payment = paymentFor(agreedPrice, verdict.authoritativeTokens);
    await settlement.settle({
      jobId: spec.jobId,
      provider,
      requester,
      authoritativeTokens: verdict.authoritativeTokens,
      resultHash: streamed.report.resultHash,
      paymentWei: payment,
    });
    metrics.jobsSettled += 1;
    metrics.tokensServed += verdict.authoritativeTokens;
    // Mirror the settlement split (same integer math the contract used) into the job record.
    const { providerPay, fee } = splitPayment(payment);
    this.persist(() =>
      this.jobs.markSettled(spec.jobId, {
        actualTokens: verdict.authoritativeTokens,
        paymentWei: payment,
        providerPayWei: providerPay,
        feeWei: fee,
      }),
    );
    // Reflect the on-chain reputation bump in the pool cache (for /v1/nodes + matching).
    await this.pool.refreshReputation(provider).catch(() => {});

    return {
      jobId: spec.jobId,
      provider,
      model: spec.model,
      content: streamed.content,
      completionTokens: verdict.authoritativeTokens,
      promptTokens: estimatePromptTokens(messages),
      finishReason: toOpenAiFinish(streamed.report.finishReason),
    };
  }

  private runJob(
    spec: JobAssignment['spec'],
    agreedPrice: bigint,
    provider: Address,
    onToken?: (delta: string) => void,
  ): Promise<StreamedJob> {
    return new Promise<StreamedJob>((resolve, reject) => {
      let content = '';
      let tokenCount = 0;
      const timer = setTimeout(
        () => {
          this.pool.releaseJob(spec.jobId);
          reject(new JobTimeoutError());
        },
        (this.config.jobDeadlineSeconds + 5) * 1000,
      );

      const assignment: JobAssignment = {
        type: 'job_assignment',
        spec,
        agreedPricePerTokenWei: agreedPrice.toString(),
      };
      try {
        this.pool.assign(provider, assignment, (msg) => {
          if (msg.type === 'token') {
            content += msg.content;
            tokenCount += 1;
            onToken?.(msg.content);
          } else if (msg.type === 'completion') {
            clearTimeout(timer);
            this.pool.releaseJob(spec.jobId);
            resolve({ content, tokenCount, report: msg });
          } else {
            clearTimeout(timer);
            this.pool.releaseJob(spec.jobId);
            reject(new Error(msg.message));
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('failed to assign job'));
      }
    });
  }
}

function estimatePromptTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.split(/\s+/).filter(Boolean).length, 0);
}

function toOpenAiFinish(reason: CompletionReport['finishReason']): FinishReason {
  if (reason === 'length') return 'length';
  if (reason === 'stop') return 'stop';
  return null;
}
