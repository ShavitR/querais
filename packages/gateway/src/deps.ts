import type { Logger } from 'pino';
import type { Address } from 'viem';
import type { SignedModelManifest } from '@querais/shared';
import type { GatewayConfig, HardeningConfig } from './config.js';
import type { ChainClient } from './chain-client.js';
import type { QuotaEnforcer } from './quota.js';
import type { NodePool } from './node-pool.js';
import type { Dispatcher } from './dispatcher.js';
import type { ApiKeyStore } from './key-store.js';
import type { Faucet } from './faucet.js';
import type { GatewayDb } from './db/index.js';
import type { JobStore } from './db/jobs.js';
import type { SessionStore } from './db/sessions.js';
import type { DebitLedgerStore } from './db/ledger.js';
import type { BatchedSettlement } from './batched-settlement.js';
import type { ReputationService } from './reputation.js';
import type { ReputationSnapshotStore } from './db/reputation-snapshots.js';
import type { NodeFlagStore } from './db/node-flags.js';
import type { IncentiveService } from './incentives.js';
import type { LayerACheckStore } from './db/layer-a-checks.js';
import type { AlertService } from './alerts.js';
import type { KeeperHealth } from './keeper-health.js';
import type { SessionAuth } from './session.js';

/** Everything the route handlers need, assembled once at startup. */
export interface GatewayDeps {
  config: GatewayConfig;
  chain: ChainClient;
  pool: NodePool;
  dispatcher: Dispatcher;
  db: GatewayDb;
  jobs: JobStore;
  keyStore: ApiKeyStore;
  faucet?: Faucet;
  /** The gateway's own address — the only settler a signed spending cap may name. */
  settler: Address;
  /** Slice 2 credit sessions + batched settlement (present unless explicitly overridden). */
  sessions?: SessionStore;
  ledger?: DebitLedgerStore;
  credit?: BatchedSettlement;
  /** Slice 4: the 5-dimension reputation oracle (accuracy EMA + derived dimensions). */
  reputation: ReputationService;
  /** Slice 4B: on-chain score-publish history (the operator console's reputation trend). */
  snapshots: ReputationSnapshotStore;
  /** Slice 5: manual-review flags (Layer-A anomalies, output patterns) + sample trail. */
  nodeFlags: NodeFlagStore;
  /** Slice 6C: the node-incentive payout recommendation engine (read-only). */
  incentives: IncentiveService;
  layerAChecks: LayerACheckStore;
  /** Slice 3 surface hardening: resolved limits + the per-key quota enforcer. */
  hardening: HardeningConfig;
  quota: QuotaEnforcer;
  /** Slice 8: the paging loop — push + sweep alerts flow through this seam. */
  alerts: AlertService;
  /** Slice 8: background-timer liveness (the `keeper-stale` rule + /v1/status). */
  keepers: KeeperHealth;
  /** Slice 10A: stateless session-cookie mint/verify for the web app's sign-in. */
  session: SessionAuth;
  /** Slice 9: the signed model manifest (loaded + signed once at boot); unset = no enforcement. */
  modelManifest?: SignedModelManifest;
  logger: Logger;
}
