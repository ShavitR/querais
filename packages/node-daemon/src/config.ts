import { homedir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toBytes, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadOrCreateKey } from './keystore.js';

export interface DaemonConfig {
  /** Deployment to load (addresses.<network>.json). */
  network: string;
  rpcUrl: string;
  gatewayWsUrl: string;
  ollamaUrl: string;
  privateKey: Hex;
  /** On-chain node id (bytes32), derived deterministically from the wallet. */
  nodeId: Hex;
  /** QAIS to stake on first registration (wei). */
  stakeWei: bigint;
  /** Ollama tags to advertise. Empty => advertise whatever Ollama reports. */
  servedModels: string[];
  /** Base price per token (wei) the node offers (used as the market-median estimate). */
  basePricePerTokenWei: bigint;
  /** Node electricity cost per token (wei); sets the auto-pricing floor. */
  electricityCostPerTokenWei: bigint;
}

function required(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const v = env[key] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${key}`);
  return v;
}

/** Derive a stable bytes32 node id from the operator wallet address. */
export function deriveNodeId(privateKey: Hex): Hex {
  const account = privateKeyToAccount(privateKey);
  return keccak256(toBytes(account.address.toLowerCase()));
}

/** Use NODE_PRIVATE_KEY if set; otherwise load (or generate) an encrypted keystore. */
function resolvePrivateKey(env: NodeJS.ProcessEnv): Hex {
  if (env.NODE_PRIVATE_KEY) return env.NODE_PRIVATE_KEY as Hex;
  const path = env.DAEMON_KEYSTORE ?? join(homedir(), '.querais', 'keystore.json');
  const password = env.DAEMON_KEYSTORE_PASSWORD ?? 'querais-dev';
  return loadOrCreateKey(path, password).privateKey;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const privateKey = resolvePrivateKey(env);
  const servedModels = (env.DAEMON_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    network: env.NETWORK ?? 'localhost',
    rpcUrl: required(env, 'RPC_URL', 'http://127.0.0.1:8545'),
    gatewayWsUrl: required(env, 'GATEWAY_WS_URL', 'ws://127.0.0.1:8787/node'),
    ollamaUrl: required(env, 'OLLAMA_URL', 'http://127.0.0.1:11434'),
    privateKey,
    nodeId: deriveNodeId(privateKey),
    stakeWei: env.DAEMON_STAKE_QAIS ? parseEther(env.DAEMON_STAKE_QAIS) : parseEther('2500'),
    servedModels,
    basePricePerTokenWei: env.DAEMON_BASE_PRICE_WEI
      ? BigInt(env.DAEMON_BASE_PRICE_WEI)
      : parseEther('0.0005'),
    electricityCostPerTokenWei: env.DAEMON_ELECTRICITY_WEI
      ? BigInt(env.DAEMON_ELECTRICITY_WEI)
      : 0n,
  };
}
