/**
 * @querais/node-daemon — the provider side.
 *
 * Registers/stakes on-chain, connects to the gateway, runs real inference behind
 * the InferenceBackend seam (Ollama for the MVP), streams tokens, and returns a
 * signed completion report. Public surface below is consumed by the e2e harness.
 */
export const NODE_DAEMON_VERSION = '0.2.0';

export * from './inference/index.js';
export { computeAutoPrice, type AutoPriceInputs } from './pricing.js';
export { buildCompletionReport } from './report.js';
export { loadConfig, deriveNodeId, type DaemonConfig } from './config.js';
export { ensureRegistered } from './registry.js';
export { GatewayClient, type GatewayClientOptions } from './gateway-client.js';
export { startDaemon } from './daemon.js';
