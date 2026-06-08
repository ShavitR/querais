import { parseEther, type Address, type Hex } from 'viem';

export interface GatewayConfig {
  port: number;
  /** Deployment to load (addresses.<network>.json): 'localhost' | 'arbitrumSepolia' | … */
  network: string;
  rpcUrl: string;
  /** Gateway wallet key — holds ORACLE + MATCHING_ENGINE roles. */
  privateKey: Hex;
  /** apiKey -> requester wallet. */
  apiKeys: Map<string, Address>;
  defaultMaxTokens: number;
  defaultMaxPricePerTokenWei: bigint;
  defaultMinReputation: number;
  jobDeadlineSeconds: number;
  /** Max requests per API key per minute (rate limiting). */
  rateLimitMax: number;
  /** Optional file path to persist issued API keys (undefined = in-memory only). */
  apiKeyStorePath?: string;
  /** Token required to call the admin key-issuance endpoint (undefined = disabled). */
  adminToken?: string;
  /** QAIS dispensed per faucet claim (wei). */
  faucetAmountWei: bigint;
  /** ETH (gas) dispensed per faucet claim (wei); 0 = none. Enables zero-touch onboarding. */
  faucetEthWei: bigint;
  /** Distributor key for the faucet (must hold QAIS + ETH); unset => faucet disabled. */
  faucetPrivateKey?: Hex;
}

function required(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const v = env[key] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${key}`);
  return v;
}

/** Parse "key:0xwallet,key2:0xwallet2" into a Map. */
function parseApiKeys(raw: string): Map<string, Address> {
  const map = new Map<string, Address>();
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const wallet = trimmed
      .slice(idx + 1)
      .trim()
      .toLowerCase() as Address;
    if (key && /^0x[0-9a-fA-F]{40}$/.test(wallet)) map.set(key, wallet);
  }
  return map;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    port: Number(env.GATEWAY_PORT ?? '8787'),
    network: env.NETWORK ?? 'localhost',
    rpcUrl: required(env, 'RPC_URL', 'http://127.0.0.1:8545'),
    privateKey: required(env, 'GATEWAY_PRIVATE_KEY') as Hex,
    apiKeys: parseApiKeys(env.GATEWAY_API_KEYS ?? ''),
    defaultMaxTokens: Number(env.GATEWAY_DEFAULT_MAX_TOKENS ?? '512'),
    defaultMaxPricePerTokenWei: env.GATEWAY_DEFAULT_MAX_PRICE_WEI
      ? BigInt(env.GATEWAY_DEFAULT_MAX_PRICE_WEI)
      : parseEther('0.001'),
    defaultMinReputation: Number(env.GATEWAY_DEFAULT_MIN_REPUTATION ?? '0'),
    jobDeadlineSeconds: Number(env.GATEWAY_JOB_DEADLINE_SECONDS ?? '120'),
    rateLimitMax: Number(env.GATEWAY_RATE_LIMIT_MAX ?? '120'),
    ...(env.GATEWAY_API_KEY_STORE ? { apiKeyStorePath: env.GATEWAY_API_KEY_STORE } : {}),
    ...(env.GATEWAY_ADMIN_TOKEN ? { adminToken: env.GATEWAY_ADMIN_TOKEN } : {}),
    faucetAmountWei: env.GATEWAY_FAUCET_AMOUNT_WEI
      ? BigInt(env.GATEWAY_FAUCET_AMOUNT_WEI)
      : parseEther('5000'),
    faucetEthWei: env.GATEWAY_FAUCET_ETH_WEI ? BigInt(env.GATEWAY_FAUCET_ETH_WEI) : 0n,
    ...(env.GATEWAY_FAUCET_PRIVATE_KEY
      ? { faucetPrivateKey: env.GATEWAY_FAUCET_PRIVATE_KEY as Hex }
      : {}),
  };
}
