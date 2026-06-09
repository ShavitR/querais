/**
 * @querais/gateway — OpenAI-compatible API gateway + centralized matching host.
 *
 * Public surface for the e2e harness and for M5 (which injects a chain-backed
 * Settlement implementation in place of the default no-op).
 */
export const GATEWAY_VERSION = '0.2.0';

export { buildGateway, type BuildOptions } from './server.js';
export {
  loadConfig,
  resolveHardening,
  HARDENING_DEFAULTS,
  type GatewayConfig,
  type HardeningConfig,
  type QuotaTier,
} from './config.js';
export { QuotaEnforcer, validatePromptLimits, type QuotaVerdict } from './quota.js';
export { ChainClient } from './chain-client.js';
export { NodePool, type NodePoolOptions } from './node-pool.js';
export { Dispatcher, type DispatchResult } from './dispatcher.js';
export {
  NoopSettlement,
  ChainSettlement,
  emaReputationBps,
  type Settlement,
  type SettlementContext,
} from './settlement.js';
export { BatchedSettlement, type BatchedSettlementOptions } from './batched-settlement.js';
export { SessionStore, type CreditSession } from './db/sessions.js';
export { DebitLedgerStore, type DebitEntry } from './db/ledger.js';
export { layerBVerify, isDegenerateLoop, type VerifyInput, type VerifyResult } from './verify.js';
export { resolveRequester } from './auth.js';
export { ApiKeyStore } from './key-store.js';
export { Faucet, FaucetError, type FaucetDistributor } from './faucet.js';
