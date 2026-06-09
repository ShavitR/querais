/**
 * @querais/shared — the contract between every layer of QueraIS.
 *
 * Pure-ish module: types, zod schemas, deterministic id/hash derivation, pricing
 * math, the OpenAI-compatible surface, the gateway↔node wire protocol, and thin
 * viem chain bindings. Imported by gateway, matching (types only), node-daemon, sdk.
 */

export const SHARED_VERSION = '0.2.0';

export * from './errors.js';
export * from './ids.js';
export * from './pricing.js';
export * from './openai.js';
export * from './jobspec.js';
export * from './messages.js';
export * from './chain.js';
export * from './spending-cap.js';
