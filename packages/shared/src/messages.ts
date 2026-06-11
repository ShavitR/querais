import { z } from 'zod';
import {
  addressSchema,
  bytes32Schema,
  decimalStringSchema,
  identifiedJobSpecSchema,
} from './jobspec.js';
import { MODEL_DIGEST_REGEX } from './model-manifest.js';

/**
 * Gateway ↔ node wire protocol (JSON over WebSocket). Two discriminated unions:
 * messages a node sends to the gateway, and messages the gateway sends to a node.
 *
 * Auth handshake: node connects → gateway sends `challenge` → node replies with
 * `hello` containing a signature over the nonce (proving wallet control) → gateway
 * verifies + checks the on-chain registry → `hello_ack`.
 */

export const nodeModelOfferSchema = z.object({
  model: z.string().min(1),
  pricePerTokenWei: decimalStringSchema,
  tokensPerSecond: z.number().nonnegative(),
});
export type NodeModelOffer = z.infer<typeof nodeModelOfferSchema>;

// ── Gateway → Node ─────────────────────────────────────────────────────────────

export const challengeSchema = z.object({
  type: z.literal('challenge'),
  nonce: z.string().min(1),
});

export const helloAckSchema = z.object({
  type: z.literal('hello_ack'),
  ok: z.boolean(),
  reason: z.string().optional(),
});

export const jobAssignmentSchema = z.object({
  type: z.literal('job_assignment'),
  spec: identifiedJobSpecSchema,
  agreedPricePerTokenWei: decimalStringSchema,
});

export const gatewayToNodeSchema = z.discriminatedUnion('type', [
  challengeSchema,
  helloAckSchema,
  jobAssignmentSchema,
]);
export type GatewayToNode = z.infer<typeof gatewayToNodeSchema>;

// ── Node → Gateway ───────────────────────────────────────────────────────────

export const nodeHelloSchema = z.object({
  type: z.literal('hello'),
  nodeId: z.string().min(1),
  wallet: addressSchema,
  nonce: z.string().min(1),
  signature: z.string().min(1),
  models: z.array(nodeModelOfferSchema).min(1),
  /** Slice 9 (additive): model → blob digest, so a manifest-enforcing gateway can
   *  verify offers at handshake. Absent on pre-Slice-9 daemons — those still join,
   *  but any model the manifest pins is dropped from their offers. */
  modelDigests: z.record(z.string().min(1), z.string().regex(MODEL_DIGEST_REGEX)).optional(),
});

export const tokenChunkSchema = z.object({
  type: z.literal('token'),
  jobId: bytes32Schema,
  content: z.string(),
});

export const completionReportSchema = z.object({
  type: z.literal('completion'),
  jobId: bytes32Schema,
  tokenCount: z.number().int().nonnegative(),
  finishReason: z.enum(['stop', 'length', 'error']),
  resultHash: bytes32Schema,
});

export const jobErrorSchema = z.object({
  type: z.literal('job_error'),
  jobId: bytes32Schema,
  message: z.string(),
});

export const nodeToGatewaySchema = z.discriminatedUnion('type', [
  nodeHelloSchema,
  tokenChunkSchema,
  completionReportSchema,
  jobErrorSchema,
]);
export type NodeToGateway = z.infer<typeof nodeToGatewaySchema>;

export type NodeHello = z.infer<typeof nodeHelloSchema>;
export type JobAssignment = z.infer<typeof jobAssignmentSchema>;
export type TokenChunk = z.infer<typeof tokenChunkSchema>;
export type CompletionReport = z.infer<typeof completionReportSchema>;
export type JobErrorMessage = z.infer<typeof jobErrorSchema>;
