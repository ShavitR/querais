import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import pino, { type Logger } from 'pino';
import { loadAddresses, makePublicClient, makeWalletClient } from '@querais/shared';
import type { GatewayConfig } from './config.js';
import { ChainClient } from './chain-client.js';
import { NodePool } from './node-pool.js';
import { Dispatcher } from './dispatcher.js';
import { ChainSettlement, type Settlement } from './settlement.js';
import type { GatewayDeps } from './deps.js';
import { registerChatCompletions } from './routes/chat-completions.js';
import { registerModels } from './routes/models.js';
import { registerNodes } from './routes/nodes.js';
import { registerJobs } from './routes/jobs.js';
import { registerStats } from './routes/stats.js';
import { registerDashboard } from './routes/dashboard.js';

export interface BuildOptions {
  config: GatewayConfig;
  /** M5 injects a chain-backed Settlement; defaults to a no-op for M4. */
  settlement?: Settlement;
  logger?: Logger;
}

/**
 * Assemble the gateway: chain clients, node pool, dispatcher, HTTP routes, and the
 * /node WebSocket endpoint where daemons connect. Returns the Fastify app and the
 * wired deps (handy for tests / the e2e harness).
 */
export async function buildGateway(
  opts: BuildOptions,
): Promise<{ app: FastifyInstance; deps: GatewayDeps }> {
  const logger = opts.logger ?? pino({ name: 'querais-gateway' });
  const deployment = loadAddresses(opts.config.network);
  const rpcUrl = deployment.rpcUrl || opts.config.rpcUrl;
  const publicClient = makePublicClient(rpcUrl, deployment.chainId);
  const walletClient = makeWalletClient(rpcUrl, opts.config.privateKey, deployment.chainId);

  const chain = new ChainClient(publicClient, walletClient, deployment);
  const pool = new NodePool(chain, logger);
  const settlement = opts.settlement ?? new ChainSettlement(chain, logger);
  const dispatcher = new Dispatcher(opts.config, chain, pool, settlement, logger);
  const deps: GatewayDeps = { config: opts.config, chain, pool, dispatcher, logger };

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(websocket);

  // Node daemons connect here and complete the signed-nonce handshake.
  app.get('/node', { websocket: true }, (socket: WebSocket) => {
    pool.handleConnection(socket);
  });

  app.get('/health', async () => ({ status: 'ok', nodes: pool.size() }));

  registerChatCompletions(app, deps);
  registerModels(app, deps);
  registerNodes(app, deps);
  registerJobs(app, deps);
  registerStats(app, deps);
  registerDashboard(app, deps);

  return { app, deps };
}
