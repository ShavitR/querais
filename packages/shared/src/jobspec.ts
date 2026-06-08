import { z } from 'zod';
import { keccak256, toBytes, type Hex } from 'viem';
import { chatMessageSchema } from './openai.js';
import { canonicalStringify } from './ids.js';

export type Address = `0x${string}`;

/** Lowercased, checksum-agnostic 20-byte address. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'invalid address')
  .transform((s) => s.toLowerCase() as Address);

/** 32-byte hex (job ids, result/commitment hashes). */
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'invalid bytes32')
  .transform((s) => s.toLowerCase() as Hex);

/** Non-negative integer encoded as a decimal string (for bigint wei amounts in JSON). */
export const decimalStringSchema = z.string().regex(/^\d+$/, 'expected a decimal integer string');

/**
 * The canonical, normalized representation of an inference job. The gateway
 * produces this from an incoming OpenAI request; it is the unit every layer
 * agrees on. bigint wei amounts are decimal strings so the spec is plain JSON.
 */
export const jobSpecSchema = z.object({
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  stream: z.boolean(),
  requesterWallet: addressSchema,
  maxPricePerTokenWei: decimalStringSchema,
  minReputation: z.number().int().min(0).max(10000),
  createdAt: z.number().int().nonnegative(),
  deadline: z.number().int().nonnegative(),
});
export type JobSpec = z.infer<typeof jobSpecSchema>;

export interface IdentifiedJobSpec extends JobSpec {
  jobId: Hex;
}

/**
 * Derive a job's id from its content. Uses canonical serialization so the id is
 * independent of field order and stable across platforms (CRLF/LF safe — content
 * is JSON-escaped verbatim, never newline-normalized). Identical jobs map to the
 * same id; any meaningful change (prompt, price, deadline) changes it.
 */
export function computeJobId(spec: JobSpec): Hex {
  const canonical = canonicalStringify({
    model: spec.model,
    messages: spec.messages,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    stream: spec.stream,
    requesterWallet: spec.requesterWallet.toLowerCase(),
    maxPricePerTokenWei: spec.maxPricePerTokenWei,
    minReputation: spec.minReputation,
    createdAt: spec.createdAt,
    deadline: spec.deadline,
  });
  return keccak256(toBytes(canonical));
}

export function identify(spec: JobSpec): IdentifiedJobSpec {
  return { ...spec, jobId: computeJobId(spec) };
}

export const identifiedJobSpecSchema = jobSpecSchema.extend({ jobId: bytes32Schema });
