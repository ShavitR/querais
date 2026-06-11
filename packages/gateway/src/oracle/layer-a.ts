import type { Address, Hex } from 'viem';
import type { Logger } from 'pino';
import { hashText, type ChatMessage } from '@querais/shared';
import type { ReputationService } from '../reputation.js';
import type { NodePool } from '../node-pool.js';
import type { LayerACheckStore, LayerAVerdict } from '../db/layer-a-checks.js';
import type { NodeFlagStore } from '../db/node-flags.js';
import { cosineSimilarity, type EmbeddingProvider } from './embeddings.js';
import { metrics } from '../metrics.js';

/**
 * Oracle-controlled inference for Layer-A re-runs (Slice 5). In Phase 1 the trusted
 * gateway IS the oracle, so "2 oracle-controlled nodes" means N re-runs on inference
 * the gateway controls (its own Ollama in production; injected fakes in tests/e2e).
 */
export interface OracleInference {
  generate(model: string, messages: ChatMessage[], maxTokens: number): Promise<string>;
}

/** Minimal Ollama chat client for oracle re-runs (non-streaming; self-contained). */
export class OllamaOracle implements OracleInference {
  constructor(private readonly baseUrl: string) {}

  async generate(model: string, messages: ChatMessage[], maxTokens: number): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { num_predict: maxTokens, temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`oracle re-run failed: HTTP ${res.status}`);
    const body = (await res.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? '';
    if (content.length === 0) throw new Error('oracle re-run returned empty output');
    return content;
  }
}

/**
 * The Slice-5B on-chain challenge hook: raise a FAST-track dispute for an anomaly and
 * let the oracle auto-resolve it (its own re-runs ARE the clear-cut evidence). Wired in
 * server.ts from ChainClient; absent (default) → flags stay off-chain-only.
 */
export interface DisputeRaiser {
  raiseAndAutoResolve(jobId: Hex, defendant: Address, evidenceHash: Hex): Promise<void>;
}

/** Spec §6.2 grade thresholds (similarity in bps of [0,1]). */
export const LAYER_A_PASS_BPS = 8500; // ≥ 0.85 → consistent with honest inference
export const LAYER_A_SOFT_BPS = 7000; // ≥ 0.70 → soft flag; below → anomaly

export function classifySimilarityBps(similarityBps: number): LayerAVerdict {
  if (similarityBps >= LAYER_A_PASS_BPS) return 'pass';
  if (similarityBps >= LAYER_A_SOFT_BPS) return 'soft';
  return 'anomaly';
}

export interface LayerAOptions {
  /** Fraction of settled jobs to sample (spec: 0.05). 0 disables, 1 samples all. */
  sampleRate: number;
  /** Oracle re-runs per sampled job (spec: 2–3). ALL must disagree to flag (2-of-N). */
  oracleRuns: number;
}

/** Everything the sampler needs about a settled job — held in memory only (prompt
 *  privacy: messages/output never touch the DB; the check row stores the verdict). */
export interface SampleContext {
  jobId: Hex;
  provider: Address;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  output: string;
}

/**
 * Layer-A semantic sampling (Slice 5, spec §6.2–6.3): re-run a sampled job's prompt on
 * oracle-controlled inference and compare embedding cosine similarity. The MAX
 * similarity across oracle runs decides (every run must disagree with the provider to
 * flag — the spec's 2-of-N redundancy against a single bad oracle run). Verdicts feed
 * the accuracy EMA at the spec's alphas; an anomaly adds a manual-review flag — never
 * an automatic slash, never a direct chain write.
 */
export class LayerASampler {
  constructor(
    private readonly inference: OracleInference,
    private readonly embeddings: EmbeddingProvider,
    private readonly checks: LayerACheckStore,
    private readonly flags: NodeFlagStore,
    private readonly reputation: ReputationService,
    private readonly pool: NodePool,
    private readonly logger: Logger,
    private readonly opts: LayerAOptions,
    /** Injectable randomness so tests pin the sampling decision. */
    private readonly random: () => number = Math.random,
    /** Slice 5B: when present, anomalies also raise + auto-resolve an on-chain dispute. */
    private readonly disputes?: DisputeRaiser,
  ) {}

  /** The dispatcher's fire-and-forget hook: decides the sample and runs the check.
   *  Never throws — a Layer-A hiccup must not affect any request. */
  maybeSample(ctx: SampleContext): void {
    if (this.opts.sampleRate <= 0 || this.random() >= this.opts.sampleRate) return;
    void this.run(ctx).catch((err: unknown) => {
      metrics.layerAFailures += 1;
      this.logger.warn({ err, jobId: ctx.jobId }, 'layer-A sample failed (non-fatal)');
    });
  }

  /** Run the semantic check for one job (exposed for tests; maybeSample wraps it). */
  async run(ctx: SampleContext): Promise<LayerAVerdict> {
    const providerVector = await this.embeddings.embed(ctx.output);
    let bestSimilarity = -1;
    for (let i = 0; i < Math.max(1, this.opts.oracleRuns); i++) {
      const oracleOutput = await this.inference.generate(ctx.model, ctx.messages, ctx.maxTokens);
      const sim = cosineSimilarity(providerVector, await this.embeddings.embed(oracleOutput));
      bestSimilarity = Math.max(bestSimilarity, sim);
    }
    const similarityBps = Math.max(0, Math.min(10000, Math.round(bestSimilarity * 10000)));
    const verdict = classifySimilarityBps(similarityBps);

    this.checks.insert({
      jobId: ctx.jobId,
      provider: ctx.provider,
      similarityBps,
      verdict,
      oracleRuns: Math.max(1, this.opts.oracleRuns),
      createdAt: Date.now(),
    });
    metrics.layerASamples += 1;

    if (verdict === 'anomaly') {
      metrics.layerAAnomalies += 1;
      this.reputation.recordOutcome(ctx.provider, 'oracle-anomaly');
      this.flags.add(
        ctx.provider,
        'layer-a:anomaly',
        `job ${ctx.jobId} similarity ${(similarityBps / 10000).toFixed(4)} < 0.70`,
      );
      this.logger.warn(
        { jobId: ctx.jobId, provider: ctx.provider, similarityBps },
        'layer-A anomaly — flagged for manual review',
      );
      await this.pool.refreshReputation(ctx.provider).catch(() => {});
      // Slice 5B challenge hook (clear-cut FAST track): the oracle's own re-runs are
      // the evidence, so it raises AND auto-resolves. Non-fatal — the flag above is
      // already durable, and a chain hiccup must not lose the review signal.
      if (this.disputes) {
        const evidenceHash = hashText(
          `layer-a anomaly job=${ctx.jobId} similarity_bps=${String(similarityBps)} runs=${String(this.opts.oracleRuns)}`,
        );
        try {
          await this.disputes.raiseAndAutoResolve(ctx.jobId, ctx.provider, evidenceHash);
          metrics.layerADisputes += 1;
          this.logger.warn(
            { jobId: ctx.jobId, provider: ctx.provider },
            'layer-A dispute raised + auto-resolved on-chain',
          );
          await this.pool.refreshReputation(ctx.provider).catch(() => {});
        } catch (err) {
          this.logger.error({ err, jobId: ctx.jobId }, 'on-chain dispute failed (flag stands)');
        }
      }
    } else if (verdict === 'soft') {
      this.reputation.recordOutcome(ctx.provider, 'oracle-soft');
      this.logger.info(
        { jobId: ctx.jobId, provider: ctx.provider, similarityBps },
        'layer-A soft signal',
      );
      await this.pool.refreshReputation(ctx.provider).catch(() => {});
    }
    // verdict === 'pass': the Layer-B pass already credited the EMA — no double count.
    return verdict;
  }
}
