import { hashText, type CompletionReport } from '@querais/shared';

/**
 * Layer-B verification — cheap, objective checks run on 100% of jobs. This is the
 * MVP's verification (semantic-similarity Layer A is deferred). It deliberately does
 * NOT compare outputs across nodes by hash: temp=0 is not deterministic across
 * hardware/backends, so cross-node hashing would falsely slash honest providers.
 *
 * Instead it pins the provider to exactly what the gateway forwarded (result-hash
 * equality), validates shape/length, and rejects degenerate loops. Economic staking
 * is the primary deterrent; this catches the cheap, obvious fraud.
 */

export interface VerifyInput {
  /** Exactly the text the gateway forwarded to the requester. */
  forwardedText: string;
  /** Tokens the gateway independently counted while proxying the stream. */
  gatewayTokenCount: number;
  /** The node's completion report. */
  report: CompletionReport;
  /** The job's max token budget. */
  maxTokens: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** Authoritative token count = min(node-reported, gateway-counted). */
  authoritativeTokens: number;
}

function fail(reason: string): VerifyResult {
  return { ok: false, reason, authoritativeTokens: 0 };
}

/** Heuristic: output is mostly one repeated token (a classic broken-generation loop). */
export function isDegenerateLoop(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  const unique = new Set(words).size;
  return unique / words.length < 0.1;
}

export function layerBVerify(input: VerifyInput): VerifyResult {
  const { forwardedText, gatewayTokenCount, report, maxTokens } = input;

  if (forwardedText.trim().length === 0) return fail('empty output');
  if (gatewayTokenCount <= 0) return fail('no tokens forwarded');
  if (report.tokenCount <= 0) return fail('node reported zero tokens');
  if (report.tokenCount > maxTokens) return fail('token count exceeds max');
  if (report.finishReason === 'error') return fail('node reported an error finish');
  // Pin the provider to the exact text the gateway saw/forwarded.
  if (report.resultHash !== hashText(forwardedText)) return fail('result hash mismatch');
  if (isDegenerateLoop(forwardedText)) return fail('degenerate repetition detected');

  return {
    ok: true,
    authoritativeTokens: Math.min(report.tokenCount, gatewayTokenCount),
  };
}
