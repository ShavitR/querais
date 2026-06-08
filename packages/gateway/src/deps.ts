import type { Logger } from 'pino';
import type { GatewayConfig } from './config.js';
import type { ChainClient } from './chain-client.js';
import type { NodePool } from './node-pool.js';
import type { Dispatcher } from './dispatcher.js';
import type { ApiKeyStore } from './key-store.js';
import type { Faucet } from './faucet.js';
import type { GatewayDb } from './db/index.js';

/** Everything the route handlers need, assembled once at startup. */
export interface GatewayDeps {
  config: GatewayConfig;
  chain: ChainClient;
  pool: NodePool;
  dispatcher: Dispatcher;
  db: GatewayDb;
  keyStore: ApiKeyStore;
  faucet?: Faucet;
  logger: Logger;
}
