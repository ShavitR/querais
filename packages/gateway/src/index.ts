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
  type Settlement,
  type SettlementContext,
} from './settlement.js';
export {
  emaReputationBps,
  compositeBps,
  latencyGradeBps,
  longevityScoreBps,
  stakeScoreBps,
  uptimeRatioBps,
  p95,
  ReputationService,
  WEIGHTS_BPS,
  INITIAL_ACCURACY_BPS,
  PASS_ALPHA,
  FAIL_ALPHA,
  type ReputationDimensions,
  type DimensionScores,
} from './reputation.js';
export { NodeSessionStore, type SessionInterval } from './db/node-sessions.js';
export { NodeReputationStore, type AccuracyState } from './db/node-reputation.js';
export { ReputationSnapshotStore, type ReputationSnapshot } from './db/reputation-snapshots.js';
export {
  LayerASampler,
  OllamaOracle,
  classifySimilarityBps,
  LAYER_A_PASS_BPS,
  LAYER_A_SOFT_BPS,
  type OracleInference,
  type LayerAOptions,
  type SampleContext,
} from './oracle/layer-a.js';
export { cosineSimilarity, OllamaEmbeddings, type EmbeddingProvider } from './oracle/embeddings.js';
export {
  PatternDetector,
  detectDuplicateOutputs,
  detectTruncationPattern,
} from './oracle/patterns.js';
export { LayerACheckStore, type LayerACheck, type LayerAVerdict } from './db/layer-a-checks.js';
export { NodeFlagStore, type NodeFlag, type NodeFlagKind } from './db/node-flags.js';
export { resolveLayerA, LAYER_A_DEFAULTS, type LayerAConfig } from './config.js';
export { BatchedSettlement, type BatchedSettlementOptions } from './batched-settlement.js';
export { SessionStore, type CreditSession } from './db/sessions.js';
export { DebitLedgerStore, type DebitEntry } from './db/ledger.js';
export { layerBVerify, isDegenerateLoop, type VerifyInput, type VerifyResult } from './verify.js';
export { resolveRequester } from './auth.js';
export { ApiKeyStore } from './key-store.js';
export { Faucet, FaucetError, type FaucetDistributor } from './faucet.js';
