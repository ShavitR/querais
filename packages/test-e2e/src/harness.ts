import { setTimeout as delay } from 'node:timers/promises';
import { parseEther, type Address, type Hex } from 'viem';
import {
  loadAddresses,
  makePublicClient,
  makeWalletClient,
  quaisTokenAbi,
  type Deployment,
} from '@querais/shared';
import { buildGateway, type GatewayConfig, type Settlement } from '@querais/gateway';
import {
  startDaemon,
  deriveNodeId,
  MockBackend,
  type DaemonConfig,
  type InferenceBackend,
} from '@querais/node-daemon';

/** Well-known Hardhat dev keys (deployer/gateway/node/requester) — local only. */
export const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  gateway: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  node: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  requester: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
} as const satisfies Record<string, Hex>;

export const API_KEY = 'sk-test';

export interface Harness {
  baseUrl: string;
  deployment: Deployment;
  requester: Address;
  apiKey: string;
  stop: () => Promise<void>;
}

export interface HarnessOptions {
  settlement?: Settlement;
  backend?: InferenceBackend;
  /** Model the daemon advertises (mock backend default 'mock-model'). */
  model?: string;
}

/**
 * Boot a full local slice against an already-running, already-deployed chain:
 * approve escrow for the requester, start the gateway (HTTP + /node WS) on an
 * ephemeral port, start one node daemon, and wait until it joins the pool.
 */
export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const deployment = loadAddresses('localhost');
  const model = opts.model ?? 'mock-model';

  // 1. Requester approves the escrow to pull job payments.
  const publicClient = makePublicClient(deployment.rpcUrl);
  const requesterWallet = makeWalletClient(deployment.rpcUrl, KEYS.requester, deployment.chainId);
  const approveHash = await requesterWallet.writeContract({
    address: deployment.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'approve',
    args: [deployment.contracts.jobEscrow, parseEther('100000')],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // 2. Gateway.
  const gatewayConfig: GatewayConfig = {
    port: 0,
    network: 'localhost',
    rpcUrl: deployment.rpcUrl,
    privateKey: KEYS.gateway,
    apiKeys: new Map([[API_KEY, deployment.accounts.requester]]),
    defaultMaxTokens: 256,
    defaultMaxPricePerTokenWei: parseEther('0.001'),
    defaultMinReputation: 0,
    jobDeadlineSeconds: 120,
  };
  // No settlement override → buildGateway uses the real ChainSettlement.
  const { app } = await buildGateway({
    config: gatewayConfig,
    ...(opts.settlement ? { settlement: opts.settlement } : {}),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind gateway port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 3. Node daemon.
  const daemonConfig: DaemonConfig = {
    network: 'localhost',
    rpcUrl: deployment.rpcUrl,
    gatewayWsUrl: `ws://127.0.0.1:${address.port}/node`,
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    privateKey: KEYS.node,
    nodeId: deriveNodeId(KEYS.node),
    stakeWei: parseEther('2500'),
    servedModels: [model],
    basePricePerTokenWei: parseEther('0.0005'),
  };
  const backend = opts.backend ?? new MockBackend([model]);
  const daemon = await startDaemon(daemonConfig, backend);

  // 4. Wait for the node to complete the handshake and join the pool.
  await waitForNodes(baseUrl, 1, 10_000);

  return {
    baseUrl,
    deployment,
    requester: deployment.accounts.requester,
    apiKey: API_KEY,
    stop: async () => {
      daemon.stop();
      await app.close();
    },
  };
}

async function waitForNodes(baseUrl: string, count: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = (await res.json()) as { nodes?: number };
      if ((body.nodes ?? 0) >= count) return;
    } catch {
      /* gateway not ready yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} node(s) to join`);
    await delay(150);
  }
}
