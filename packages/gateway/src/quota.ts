import type { Address } from 'viem';
import type { ChatCompletionRequest } from '@querais/shared';
import type { HardeningConfig, QuotaTier } from './config.js';
import type { JobStore } from './db/jobs.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Anything that can resolve an API key's quota tier (the ApiKeyStore). */
export interface TierLookup {
  tierOf(key: string): string | undefined;
}

export interface QuotaVerdict {
  ok: boolean;
  tier: string;
  limitJobs: number;
  remainingJobs: number;
  limitTokens: number;
  remainingTokens: number;
}

/**
 * Per-key daily quotas (Slice 3). Budgets come from the key's tier; consumption is DERIVED
 * from the persisted job rows of the key's requester wallet over a rolling 24h window — no
 * separate counter table to keep in sync (same principle as /v1/usage). Every dispatched
 * job counts against the job budget (failed attempts burn quota too — that's the abuse
 * deterrent); tokens count as settled.
 */
export class QuotaEnforcer {
  constructor(
    private readonly jobs: JobStore,
    private readonly keys: TierLookup,
    private readonly tiers: Record<string, QuotaTier>,
  ) {}

  check(apiKey: string, requester: Address): QuotaVerdict {
    const tier = this.keys.tierOf(apiKey) ?? 'free';
    const budget = this.tiers[tier] ?? this.tiers['free'] ?? { dailyJobs: 0, dailyTokens: 0 };
    const usage = this.jobs.usageSince(requester, Date.now() - DAY_MS);
    const remainingJobs = Math.max(0, budget.dailyJobs - usage.jobs);
    const remainingTokens = Math.max(0, budget.dailyTokens - usage.tokens);
    return {
      ok: remainingJobs > 0 && remainingTokens > 0,
      tier,
      limitJobs: budget.dailyJobs,
      remainingJobs,
      limitTokens: budget.dailyTokens,
      remainingTokens,
    };
  }
}

/**
 * Prompt-abuse limits, enforced before any matching or chain interaction. Returns a
 * human-readable refusal or undefined when the request is within bounds.
 */
export function validatePromptLimits(
  req: ChatCompletionRequest,
  h: HardeningConfig,
): string | undefined {
  if (req.messages.length > h.maxMessages) {
    return `too many messages (max ${h.maxMessages})`;
  }
  let chars = 0;
  for (const m of req.messages) chars += m.content.length;
  if (chars > h.maxPromptChars) {
    return `prompt too large (${chars} chars, max ${h.maxPromptChars})`;
  }
  if (req.max_tokens != null && req.max_tokens > h.maxTokensCap) {
    return `max_tokens too large (max ${h.maxTokensCap})`;
  }
  for (const pattern of h.bannedPatterns) {
    for (const m of req.messages) {
      if (pattern.test(m.content)) return 'prompt contains disallowed content';
    }
  }
  return undefined;
}
