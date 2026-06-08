import { hashText, type CompletionReport } from '@querais/shared';
import type { Hex } from 'viem';
import type { InferenceResult } from './inference/backend.js';

/**
 * Build the signed-off completion report the node returns to the gateway. The
 * `resultHash` commits to the exact text produced; the gateway recomputes it over
 * what it forwarded to the requester (Layer-B), pinning the provider to its output.
 */
export function buildCompletionReport(jobId: Hex, result: InferenceResult): CompletionReport {
  return {
    type: 'completion',
    jobId,
    tokenCount: result.completionTokens,
    finishReason: result.finishReason,
    resultHash: hashText(result.content),
  };
}
