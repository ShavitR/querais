import pino from 'pino';
import {
  loadAddresses,
  makePublicClient,
  makeWalletClient,
  type NodeModelOffer,
} from '@querais/shared';
import type { DaemonConfig } from './config.js';
import { OllamaBackend } from './inference/ollama.js';
import type { InferenceBackend } from './inference/backend.js';
import { ensureRegistered } from './registry.js';
import { GatewayClient } from './gateway-client.js';
import { computeAutoPrice } from './pricing.js';

/**
 * Wire the daemon together: verify the inference backend, decide which models to
 * advertise, register/stake on-chain, then connect to the gateway and start
 * serving jobs. Returns the live GatewayClient so callers (e2e) can stop it.
 */
export async function startDaemon(
  config: DaemonConfig,
  backend?: InferenceBackend,
): Promise<GatewayClient> {
  const logger = pino({ name: 'querais-node' });
  const infer = backend ?? new OllamaBackend(config.ollamaUrl);

  if (!(await infer.isAvailable())) {
    throw new Error(
      `Inference backend '${infer.name}' unavailable (is Ollama running at ${config.ollamaUrl}?)`,
    );
  }

  // Pull any explicitly-configured models that aren't present yet.
  if (config.servedModels.length && infer.ensureModel) {
    for (const m of config.servedModels) {
      logger.info({ model: m }, 'ensuring model is available (pulling if needed)…');
      await infer.ensureModel(m);
    }
  }

  const available = await infer.listModels();
  const served = config.servedModels.length
    ? config.servedModels.filter((m) => available.includes(m))
    : available;
  if (served.length === 0) {
    throw new Error(
      `No models available to serve (backend reported: ${available.join(', ') || 'none'})`,
    );
  }

  // Auto-price: at startup we have no live load and start at the onboarding
  // reputation (0.70); the price is the market estimate adjusted + electricity-floored.
  const priceWei = computeAutoPrice({
    marketMedianWei: config.basePricePerTokenWei,
    loadFraction: 0,
    reputationBps: 7000,
    electricityCostPerTokenWei: config.electricityCostPerTokenWei,
  });
  const models: NodeModelOffer[] = served.map((model) => ({
    model,
    pricePerTokenWei: priceWei.toString(),
    tokensPerSecond: 0,
  }));

  const deployment = loadAddresses(config.network);
  const rpcUrl = deployment.rpcUrl || config.rpcUrl;
  const publicClient = makePublicClient(rpcUrl, deployment.chainId);
  const walletClient = makeWalletClient(rpcUrl, config.privateKey, deployment.chainId);

  const { alreadyRegistered } = await ensureRegistered(
    publicClient,
    walletClient,
    deployment,
    config.nodeId,
    config.stakeWei,
  );
  logger.info(
    { wallet: walletClient.account.address, alreadyRegistered, models: served },
    'node ready on-chain',
  );

  const client = new GatewayClient({
    wsUrl: config.gatewayWsUrl,
    walletClient,
    nodeId: config.nodeId,
    models,
    backend: infer,
    logger,
  });
  client.start();
  return client;
}
