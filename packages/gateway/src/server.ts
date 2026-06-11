import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import type { WebSocket } from 'ws';
import type { Address, Hex } from 'viem';
import pino, { type Logger } from 'pino';
import { metrics, renderMetrics } from './metrics.js';
import { loadAddresses, makePublicClient, makeWalletClient, quaisTokenAbi } from '@querais/shared';
import { resolveAlerts, resolveHardening, resolveLayerA, type GatewayConfig } from './config.js';
import {
  AlertService,
  NoopSink,
  WebhookSink,
  redactWebhookUrl,
  type AlertSink,
} from './alerts.js';
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
import { registerFlags } from './routes/flags.js';
import { registerStatus } from './routes/status.js';
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
import { LayerACheckStore } from './db/layer-a-checks.js';
import { NodeFlagStore } from './db/node-flags.js';
import { LayerASampler, OllamaOracle, type OracleInference } from './oracle/layer-a.js';
import { OllamaEmbeddings, type EmbeddingProvider } from './oracle/embeddings.js';
import { PatternDetector } from './oracle/patterns.js';
import { IncentiveService, resolveIncentives } from './incentives.js';
import { registerIncentives } from './routes/incentives.js';
import { BatchedSettlement } from './batched-settlement.js';
import { KeeperHealth } from './keeper-health.js';
import { AlertSweeper, type SweepReads } from './alert-rules.js';
import { registerUsage } from './routes/usage.js';
import { registerSessions } from './routes/sessions.js';

export interface BuildOptions {
  config: GatewayConfig;
  /** M5 injects a chain-backed Settlement; defaults to a no-op for M4. */
  settlement?: Settlement;
  /** Slice 5: inject oracle inference/embeddings (tests/e2e); production builds them
   *  from `config.layerA.ollamaUrl`. Sampling is disabled when neither exists. */
  layerA?: { inference?: OracleInference; embeddings?: EmbeddingProvider };
  /** Slice 8: inject an alert sink (tests use MemorySink); production builds a
   *  WebhookSink from `config.alerts.webhookUrl`, or NoopSink when unset. */
  alertSink?: AlertSink;
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
  // Slice 8 paging loop: push sites (Layer-A, patterns, reputation) and the sweep keeper
  // all raise through this one seam. No webhook configured → noop sink, gateway runs fine.
  const alertsCfg = resolveAlerts(opts.config.alerts);
  const alertSink =
    opts.alertSink ??
    (alertsCfg.webhookUrl
      ? new WebhookSink(alertsCfg.webhookUrl, alertsCfg.webhookFormat)
      : new NoopSink());
  const alerts = new AlertService(alertSink, logger, {
    cooldownSeconds: alertsCfg.cooldownSeconds,
    minSeverity: alertsCfg.minSeverity,
  });
  if (alertsCfg.webhookUrl) {
    // Redaction discipline: the URL embeds a channel token — log the host only.
    logger.info(
      {
        webhookHost: redactWebhookUrl(alertsCfg.webhookUrl),
        format: alertsCfg.webhookFormat,
        minSeverity: alertsCfg.minSeverity,
      },
      'alerting armed',
    );
  } else if (!opts.alertSink) {
    logger.warn('alerting disabled — GATEWAY_ALERT_WEBHOOK_URL not set');
  }
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
    alerts,
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
  // Slice 5 Layer-A oracle: semantic sampling needs oracle inference + embeddings —
  // injected seams (tests/e2e) or an Ollama endpoint from config; otherwise disabled.
  const layerACfg = resolveLayerA(opts.config.layerA);
  const layerAChecks = new LayerACheckStore(db);
  const nodeFlags = new NodeFlagStore(db);
  const oracleInference =
    opts.layerA?.inference ??
    (layerACfg.ollamaUrl ? new OllamaOracle(layerACfg.ollamaUrl) : undefined);
  const oracleEmbeddings =
    opts.layerA?.embeddings ??
    (layerACfg.ollamaUrl
      ? new OllamaEmbeddings(layerACfg.ollamaUrl, layerACfg.embedModel)
      : undefined);
  // Slice 5B challenge hook: anomalies raise + auto-resolve a FAST-track dispute when
  // enabled AND this deployment has the contract (pre-5B manifests: flags only).
  const disputeRaiser =
    layerACfg.disputeOnAnomaly && chain.disputeContract()
      ? {
          raiseAndAutoResolve: async (jobId: Hex, defendant: Address, evidenceHash: Hex) => {
            await chain.ensureDisputeAllowance();
            await chain.raiseDispute(jobId, defendant, evidenceHash);
            await chain.autoResolveDispute(jobId, true);
          },
        }
      : undefined;
  if (layerACfg.disputeOnAnomaly && !chain.disputeContract()) {
    logger.warn('GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY set but no DisputeResolution deployed');
  }
  const layerA =
    oracleInference && oracleEmbeddings
      ? new LayerASampler(
          oracleInference,
          oracleEmbeddings,
          layerAChecks,
          nodeFlags,
          reputation,
          pool,
          logger,
          { sampleRate: layerACfg.sampleRate, oracleRuns: layerACfg.oracleRuns },
          undefined,
          disputeRaiser,
          alerts,
        )
      : undefined;
  const patterns = new PatternDetector(db, nodeFlags, logger, alerts);
  // Slice 6C: read-only incentive recommendations (the operator pays via ops:allocate).
  const incentives = new IncentiveService(
    chain,
    nodeSessions,
    jobs,
    resolveIncentives(opts.config.incentives),
    logger,
  );

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
    layerA,
  );
  const keyStore = new ApiKeyStore(db, opts.config.apiKeys);
  const quota = new QuotaEnforcer(jobs, keyStore, hardening.quotaTiers);

  // Optional faucet (only if a distributor key holding QAIS is configured).
  let faucet: Faucet | undefined;
  let faucetSweepReads: SweepReads['faucet'];
  if (opts.config.faucetPrivateKey) {
    const distWallet = makeWalletClient(rpcUrl, opts.config.faucetPrivateKey, deployment.chainId);
    const distributor = {
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
    } satisfies FaucetDistributor;
    faucet = new Faucet(db, distributor, opts.config.faucetAmountWei, opts.config.faucetEthWei, {
      ipDailyLimit: hardening.faucetIpDailyLimit,
      dailyCap: hardening.faucetDailyCap,
    });
    // Slice 8 `faucet-low` sweep: the well's balances vs the per-claim amounts.
    faucetSweepReads = {
      qaisBalance: distributor.qaisBalance,
      ethBalance: distributor.ethBalance,
      claimQaisWei: opts.config.faucetAmountWei,
      claimEthWei: opts.config.faucetEthWei,
    };
  }

  // Slice 8 keeper liveness: every background timer registers + beats here; the
  // `keeper-stale` sweep rule pages when one stops succeeding.
  const keepers = new KeeperHealth();

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
    nodeFlags,
    layerAChecks,
    incentives,
    hardening,
    quota,
    alerts,
    keepers,
    logger,
  };

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  // Interval flush ("flush every N sec / M jobs"): a low-traffic requester's debits never
  // wait unboundedly for the threshold. unref() so the timer can't hold the process open.
  keepers.register('flush', opts.config.batchFlushIntervalSeconds * 1000);
  const flushTimer = setInterval(() => {
    void credit
      .flushAll()
      .then(() => keepers.beat('flush'))
      .catch((err: unknown) => logger.error({ err }, 'interval flushAll failed'));
  }, opts.config.batchFlushIntervalSeconds * 1000);
  flushTimer.unref();
  // Daily reputation epoch (Slice 4B): publish every known node's composite on-chain.
  // Same lifecycle pattern as the flush timer; the interval shrinks to seconds in e2e.
  keepers.register('snapshot', opts.config.reputationSnapshotIntervalSeconds * 1000);
  const snapshotTimer = setInterval(() => {
    void reputation
      .snapshotAll()
      .then(() => keepers.beat('snapshot'))
      .catch((err: unknown) => logger.error({ err }, 'reputation snapshot sweep failed'));
  }, opts.config.reputationSnapshotIntervalSeconds * 1000);
  snapshotTimer.unref();
  // Output-pattern sweep (Slice 5): rolling 7-day cheater signals from job rows.
  keepers.register('patterns', layerACfg.patternScanIntervalSeconds * 1000);
  const patternTimer = setInterval(() => {
    try {
      patterns.scanAll();
      keepers.beat('patterns');
    } catch (err) {
      logger.error({ err }, 'pattern scan failed');
    }
  }, layerACfg.patternScanIntervalSeconds * 1000);
  patternTimer.unref();
  // Treasury epoch sweep (Slice 6A) + staking-rewards epoch credit (6B): one keeper
  // tick runs both in order, so the staker share a sweep just paid out is credited to
  // operators in the same tick. Reads pending first so empty epochs are quiet no-ops.
  // Each step is auto-disabled on manifests that predate its contract.
  if (chain.treasuryContract() || chain.stakingRewardsContract()) {
    keepers.register('treasury', opts.config.treasuryDistributeIntervalSeconds * 1000);
  }
  const treasuryTimer =
    chain.treasuryContract() || chain.stakingRewardsContract()
      ? setInterval(() => {
          void (async () => {
            try {
              if (chain.treasuryContract() && (await chain.treasuryPending()) > 0n) {
                await chain.distributeTreasury();
                metrics.treasuryDistributions += 1;
                logger.info('treasury distributed (60/20/20 epoch sweep)');
              }
            } catch (err) {
              metrics.treasuryDistributeFailures += 1;
              logger.error({ err }, 'treasury distribute failed');
            }
            try {
              if (chain.stakingRewardsContract() && (await chain.rewardsPending()) > 0n) {
                await chain.distributeRewardsEpoch();
                metrics.rewardsEpochs += 1;
                logger.info('staking rewards credited (pro-rata epoch)');
              }
            } catch (err) {
              metrics.rewardsEpochFailures += 1;
              logger.error({ err }, 'rewards epoch credit failed');
            }
            // The beat means "the timer ticked to completion" — individual tx failures
            // have their own metrics; keeper-stale is about the timer dying silently.
            keepers.beat('treasury');
          })();
        }, opts.config.treasuryDistributeIntervalSeconds * 1000)
      : undefined;
  treasuryTimer?.unref();
  // Slice 8 alert sweep: the catalogue rules (gas, stuck debits, settle streak, node
  // drop, open flags, faucet, stale keepers, RPC) evaluated over injected reads.
  // Dedup/cooldown lives in AlertService, so the tight interval stays quiet.
  const sweeper = new AlertSweeper(
    alerts,
    {
      gasBalanceWei: () => chain.ethBalance(settler),
      hotWalletQaisWei: () => chain.tokenBalance(settler),
      oldestPendingDebitAt: () => credit.oldestPendingDebitAt(),
      consecutiveFlushFailures: () => credit.consecutiveFlushFailures(),
      connectedNodes: () => pool.size(),
      openFlagCount: () => nodeFlags.openCount(),
      faucet: faucetSweepReads,
      staleKeepers: (now) => keepers.stale(now),
      rpcProbe: async () => {
        await chain.latestBlockTimestamp();
      },
    },
    {
      gasMinWei: alertsCfg.gasMinWei,
      debitMaxAgeSeconds: alertsCfg.debitMaxAgeSeconds,
      settleFailStreak: alertsCfg.settleFailStreak,
    },
  );
  keepers.register('alert-sweep', alertsCfg.sweepIntervalSeconds * 1000);
  const sweepTimer = setInterval(() => {
    void sweeper
      .sweep()
      .then(() => keepers.beat('alert-sweep'))
      .catch((err: unknown) => logger.error({ err }, 'alert sweep failed'));
  }, alertsCfg.sweepIntervalSeconds * 1000);
  sweepTimer.unref();
  // On graceful shutdown: flush any unsettled batched debits, then release the SQLite
  // connection (and its WAL handles).
  app.addHook('onClose', async () => {
    clearInterval(flushTimer);
    clearInterval(snapshotTimer);
    clearInterval(patternTimer);
    clearInterval(sweepTimer);
    if (treasuryTimer) clearInterval(treasuryTimer);
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
  // Liveness: the process is up and serving. Cheap, never touches the chain — a
  // platform restarts the container only when THIS fails.
  app.get('/health', noLimit, async () => ({ status: 'ok', nodes: pool.size() }));
  // Readiness: the gateway can actually do work — the RPC is reachable AND the DB is
  // open. Returns 503 otherwise so a load balancer drains this instance instead of
  // routing jobs that would fail at the first chain call. (Slice 7A.)
  app.get('/ready', noLimit, async (_req, reply) => {
    try {
      await chain.latestBlockTimestamp();
      db.conn.prepare('PRAGMA user_version').get();
    } catch (err) {
      logger.warn({ err }, 'readiness probe failed');
      return reply.code(503).send({ ready: false, nodes: pool.size() });
    }
    return reply.send({ ready: true, nodes: pool.size() });
  });
  app.get('/metrics', noLimit, async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    // Scrape-time gauges are cheap sync reads (SQLite/pool); the RPC-priced ones
    // (gas, balances) come from the metrics object, refreshed by the alert sweep.
    const oldestDebit = credit.oldestPendingDebitAt();
    return reply.send(
      renderMetrics({
        nodes: pool.size(),
        pendingDebits: ledger.pendingCount(),
        pendingDebitValueQais: Number(ledger.pendingValueWei()) / 1e18,
        oldestPendingDebitAgeSeconds:
          oldestDebit === undefined ? 0 : Math.floor((Date.now() - oldestDebit) / 1000),
        openFlags: nodeFlags.openCount(),
        keepers: keepers.list(),
      }),
    );
  });

  registerChatCompletions(app, deps);
  registerModels(app, deps);
  registerNodes(app, deps);
  registerJobs(app, deps);
  registerUsage(app, deps);
  registerSessions(app, deps);
  registerStats(app, deps);
  registerStatus(app, deps);
  registerDashboard(app, deps);
  registerKeys(app, deps);
  registerFlags(app, deps);
  registerIncentives(app, deps);
  if (faucet) registerFaucet(app, deps);

  return { app, deps };
}
