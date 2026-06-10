import type { Logger } from 'pino';
import type { Address } from 'viem';
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
  /** Slice 3 surface hardening: resolved limits + the per-key quota enforcer. */
  hardening: HardeningConfig;
  quota: QuotaEnforcer;
  logger: Logger;
}
