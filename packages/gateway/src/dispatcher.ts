import type { Logger } from 'pino';
import type { Address, Hex } from 'viem';
import {
  identify,
  per1kQaisToWeiPerToken,
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
    private readonly logger: Logger,
  ) {}

  async dispatch(
    req: ChatCompletionRequest,
    requester: Address,
    onToken?: (delta: string) => void,
  ): Promise<DispatchResult> {
    const now = Math.floor(Date.now() / 1000);
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
      deadline: now + this.config.jobDeadlineSeconds,
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

    // ── Lock + assign on-chain ──
    await this.chain.createJob(
      spec.jobId,
      requester,
      maxPricePerTokenWei,
      BigInt(maxTokens),
      BigInt(spec.deadline),
    );
    await this.chain.assignJob(spec.jobId, provider, agreedPrice);
    metrics.jobsCreated += 1;
    this.logger.info({ jobId: spec.jobId, provider, model: spec.model }, 'job created & assigned');

    // ── Stream from the node ──
    const streamed = await this.runJob(spec, agreedPrice, provider, onToken);

    // ── Layer-B verify ──
    const verdict = layerBVerify({
      forwardedText: streamed.content,
      gatewayTokenCount: streamed.tokenCount,
      report: streamed.report,
      maxTokens,
    });
    if (!verdict.ok) {
      metrics.jobsFailed += 1;
      await this.settlement.fail(spec.jobId, verdict.reason ?? 'verification failed');
      throw new VerificationError(verdict.reason ?? 'verification failed');
    }

    // ── Settle (no-op in M4, chain-backed in M5) ──
    await this.settlement.settle({
      jobId: spec.jobId,
      provider,
      requester,
      authoritativeTokens: verdict.authoritativeTokens,
      resultHash: streamed.report.resultHash,
    });
    metrics.jobsSettled += 1;
    metrics.tokensServed += verdict.authoritativeTokens;

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
