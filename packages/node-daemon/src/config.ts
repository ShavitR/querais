import { keccak256, toBytes, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface DaemonConfig {
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
  /** Base price per token (wei) the node offers. */
  basePricePerTokenWei: bigint;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const privateKey = required(env, 'NODE_PRIVATE_KEY') as Hex;
  const servedModels = (env.DAEMON_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
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
  };
}
