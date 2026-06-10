import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import type { WebSocket } from 'ws';
import pino, { type Logger } from 'pino';
import { renderMetrics } from './metrics.js';
import { loadAddresses, makePublicClient, makeWalletClient, quaisTokenAbi } from '@querais/shared';
import { resolveHardening, type GatewayConfig } from './config.js';
import { QuotaEnforcer } from './quota.js';
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
import { registerKeys } from './routes/keys.js';
import { registerFaucet } from './routes/faucet.js';
import { ApiKeyStore } from './key-store.js';
import { Faucet, type FaucetDistributor } from './faucet.js';
import { GatewayDb } from './db/index.js';
import { JobStore } from './db/jobs.js';
import { SessionStore } from './db/sessions.js';
import { DebitLedgerStore } from './db/ledger.js';
import { NodeSessionStore } from './db/node-sessions.js';
import { NodeReputationStore } from './db/node-reputation.js';
import { ReputationSnapshotStore } from './db/reputation-snapshots.js';
import { ReputationService } from './reputation.js';
import { BatchedSettlement } from './batched-settlement.js';
import { registerUsage } from './routes/usage.js';
import { registerSessions } from './routes/sessions.js';

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
  const settler = walletClient.account.address;
  // Slice 3 surface hardening: resolved once, shared by routes, faucet, and the WS pool.
  const hardening = resolveHardening(opts.config.hardening);
  const settlement = opts.settlement ?? new ChainSettlement(chain, logger);
  const db = new GatewayDb(opts.config.dbPath);
  const jobs = new JobStore(db);
  // Slice 4 reputation: uptime session intervals + the accuracy-EMA working state feed
  // the 5-dimension composite the pool serves to matching. Sessions a crashed gateway
  // left open are closed at their last_seen before anything reads them.
  const nodeSessions = new NodeSessionStore(db);
  nodeSessions.closeAllOpen();
  const nodeReputation = new NodeReputationStore(db);
  const snapshots = new ReputationSnapshotStore(db);
  const reputation = new ReputationService(
    chain,
    nodeReputation,
    nodeSessions,
    jobs,
    snapshots,
    logger,
  );
  const pool = new NodePool(
    chain,
    logger,
    {
      maxConnections: hardening.wsMaxConnections,
      maxPerIp: hardening.wsMaxPerIp,
      handshakeTimeoutMs: hardening.wsHandshakeTimeoutMs,
      maxMessagesPerSecond: hardening.wsMaxMessagesPerSecond,
      pingIntervalMs: hardening.wsPingIntervalMs,
    },
    { reputation, sessions: nodeSessions },
  );
  // Slice 2: durable signed-cap sessions + the batched-settlement venue. Dormant until a
  // requester opens a session via POST /v1/sessions; otherwise the per-job escrow path runs.
  const sessions = new SessionStore(db);
  const ledger = new DebitLedgerStore(db);
  const credit = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: opts.config.batchFlushThreshold,
    deadlineMarginSeconds: opts.config.sessionDeadlineMarginSeconds,
  });
  const dispatcher = new Dispatcher(
    opts.config,
    chain,
    pool,
    settlement,
    jobs,
    logger,
    sessions,
    credit,
    reputation,
  );
  const keyStore = new ApiKeyStore(db, opts.config.apiKeys);
  const quota = new QuotaEnforcer(jobs, keyStore, hardening.quotaTiers);

  // Optional faucet (only if a distributor key holding QAIS is configured).
  let faucet: Faucet | undefined;
  if (opts.config.faucetPrivateKey) {
    const distWallet = makeWalletClient(rpcUrl, opts.config.faucetPrivateKey, deployment.chainId);
    const distributor: FaucetDistributor = {
      transferQais: async (to, amount) => {
        const hash = await distWallet.writeContract({
          address: deployment.contracts.token,
          abi: quaisTokenAbi,
          functionName: 'transfer',
          args: [to, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
      },
      sendEth: async (to, value) => {
        const hash = await distWallet.sendTransaction({ to, value });
        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
      },
      // Balance guard (Slice 3): the faucet refuses cleanly once the well is dry.
      qaisBalance: () =>
        publicClient.readContract({
          address: deployment.contracts.token,
          abi: quaisTokenAbi,
          functionName: 'balanceOf',
          args: [distWallet.account.address],
        }),
      ethBalance: () => publicClient.getBalance({ address: distWallet.account.address }),
    };
    faucet = new Faucet(db, distributor, opts.config.faucetAmountWei, opts.config.faucetEthWei, {
      ipDailyLimit: hardening.faucetIpDailyLimit,
      dailyCap: hardening.faucetDailyCap,
    });
  }

  const deps: GatewayDeps = {
    config: opts.config,
    chain,
    pool,
    dispatcher,
    db,
    jobs,
    keyStore,
    faucet,
    settler,
    sessions,
    ledger,
    credit,
    reputation,
    hardening,
    quota,
    logger,
  };

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  // Interval flush ("flush every N sec / M jobs"): a low-traffic requester's debits never
  // wait unboundedly for the threshold. unref() so the timer can't hold the process open.
  const flushTimer = setInterval(() => {
    void credit
      .flushAll()
      .catch((err: unknown) => logger.error({ err }, 'interval flushAll failed'));
  }, opts.config.batchFlushIntervalSeconds * 1000);
  flushTimer.unref();
  // Daily reputation epoch (Slice 4B): publish every known node's composite on-chain.
  // Same lifecycle pattern as the flush timer; the interval shrinks to seconds in e2e.
  const snapshotTimer = setInterval(() => {
    void reputation
      .snapshotAll()
      .catch((err: unknown) => logger.error({ err }, 'reputation snapshot sweep failed'));
  }, opts.config.reputationSnapshotIntervalSeconds * 1000);
  snapshotTimer.unref();
  // On graceful shutdown: flush any unsettled batched debits, then release the SQLite
  // connection (and its WAL handles).
  app.addHook('onClose', async () => {
    clearInterval(flushTimer);
    clearInterval(snapshotTimer);
    await credit.flushAll().catch((err: unknown) => logger.error({ err }, 'flushAll on close'));
    db.close();
  });
  // Cap WS frame size so a misbehaving node can't send oversized messages.
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // Per-API-key rate limiting on the /v1 API (infra routes opt out below).
  await app.register(rateLimit, {
    max: opts.config.rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth ? auth.replace(/^Bearer\s+/i, '').trim() : (req.ip ?? 'anon');
    },
  });

  // Infra endpoints — excluded from rate limiting.
  const noLimit = { config: { rateLimit: false } };
  app.get('/node', { websocket: true, ...noLimit }, (socket: WebSocket, request) => {
    pool.handleConnection(socket, (request as FastifyRequest).ip);
  });
  app.get('/health', noLimit, async () => ({ status: 'ok', nodes: pool.size() }));
  app.get('/ready', noLimit, async () => ({ ready: true, nodes: pool.size() }));
  app.get('/metrics', noLimit, async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return reply.send(renderMetrics(pool.size()));
  });

  registerChatCompletions(app, deps);
  registerModels(app, deps);
  registerNodes(app, deps);
  registerJobs(app, deps);
  registerUsage(app, deps);
  registerSessions(app, deps);
  registerStats(app, deps);
  registerDashboard(app, deps);
  registerKeys(app, deps);
  if (faucet) registerFaucet(app, deps);

  return { app, deps };
}
