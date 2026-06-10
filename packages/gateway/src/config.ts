import { parseEther, type Address, type Hex } from 'viem';

/** Daily budgets for one API-key quota tier. */
export interface QuotaTier {
  dailyJobs: number;
  dailyTokens: number;
}

/**
 * Slice 3 surface-hardening knobs. All optional with safe defaults (see
 * {@link HARDENING_DEFAULTS}) so existing config call-sites are untouched; override
 * any subset via `hardening` in {@link GatewayConfig} or the `GATEWAY_*` env vars.
 */
export interface HardeningConfig {
  /** Max faucet claims per source IP per rolling 24h. */
  faucetIpDailyLimit: number;
  /** Max faucet claims network-wide per rolling 24h. */
  faucetDailyCap: number;
  /** Per-key quota tiers (the `tier` column on api_keys selects one; default 'free'). */
  quotaTiers: Record<string, QuotaTier>;
  /** Prompt-abuse limits, enforced before any chain interaction. */
  maxMessages: number;
  maxPromptChars: number;
  maxTokensCap: number;
  /** Reject prompts matching any of these patterns (default: none). */
  bannedPatterns: RegExp[];
  /** /node WebSocket flood protection. */
  wsMaxConnections: number;
  wsMaxPerIp: number;
  wsHandshakeTimeoutMs: number;
  wsMaxMessagesPerSecond: number;
  /** ws keepalive ping cadence (dead-TCP detection + uptime last_seen, Slice 4). */
  wsPingIntervalMs: number;
}

export const HARDENING_DEFAULTS: HardeningConfig = {
  faucetIpDailyLimit: 3,
  faucetDailyCap: 100,
  quotaTiers: {
    free: { dailyJobs: 200, dailyTokens: 200_000 },
    pro: { dailyJobs: 5_000, dailyTokens: 5_000_000 },
    unlimited: { dailyJobs: Number.MAX_SAFE_INTEGER, dailyTokens: Number.MAX_SAFE_INTEGER },
  },
  maxMessages: 50,
  maxPromptChars: 32_000,
  maxTokensCap: 4_096,
  bannedPatterns: [],
  wsMaxConnections: 256,
  wsMaxPerIp: 4,
  wsHandshakeTimeoutMs: 10_000,
  // Generous: every streamed token is one WS message, so a fast node serving
  // back-to-back jobs legitimately sustains ~1k msg/s. This blocks raw floods only.
  wsMaxMessagesPerSecond: 5_000,
  wsPingIntervalMs: 60_000,
};

/** Merge a partial override (config/env) over the hardening defaults. */
export function resolveHardening(partial?: Partial<HardeningConfig>): HardeningConfig {
  return { ...HARDENING_DEFAULTS, ...partial };
}

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
  /** Optional SQLite file path for durable gateway state (undefined = in-memory only). */
  dbPath?: string;
  /** Token required to call the admin key-issuance endpoint (undefined = disabled). */
  adminToken?: string;
  /** QAIS dispensed per faucet claim (wei). */
  faucetAmountWei: bigint;
  /** ETH (gas) dispensed per faucet claim (wei); 0 = none. Enables zero-touch onboarding. */
  faucetEthWei: bigint;
  /** Distributor key for the faucet (must hold QAIS + ETH); unset => faucet disabled. */
  faucetPrivateKey?: Hex;
  /** Slice 2: flush a requester's accrued debits to CreditAccount.batchSettle once this many
   *  jobs have settled off-chain (also flushed on graceful shutdown). */
  batchFlushThreshold: number;
  /** Slice 2C: also flush every requester's pending debits on this interval, so a
   *  low-traffic requester never waits unboundedly for the threshold. */
  batchFlushIntervalSeconds: number;
  /** Slice 2C: stop routing jobs to the batched venue (and flush what's pending) once a
   *  session cap is within this many seconds of its deadline — a debit that misses the
   *  deadline can never settle on-chain. */
  sessionDeadlineMarginSeconds: number;
  /** Slice 3: surface-hardening overrides (faucet throttles, quota tiers, prompt limits,
   *  WS caps). Unset fields fall back to HARDENING_DEFAULTS. */
  hardening?: Partial<HardeningConfig>;
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

/** Read any GATEWAY_* hardening overrides present in the environment. */
function hardeningFromEnv(env: NodeJS.ProcessEnv): Partial<HardeningConfig> {
  const out: Partial<HardeningConfig> = {};
  const num = (key: string, field: keyof HardeningConfig) => {
    if (env[key] !== undefined && env[key] !== '') {
      (out as Record<string, unknown>)[field] = Number(env[key]);
    }
  };
  num('GATEWAY_FAUCET_IP_DAILY_LIMIT', 'faucetIpDailyLimit');
  num('GATEWAY_FAUCET_DAILY_CAP', 'faucetDailyCap');
  num('GATEWAY_MAX_MESSAGES', 'maxMessages');
  num('GATEWAY_MAX_PROMPT_CHARS', 'maxPromptChars');
  num('GATEWAY_MAX_TOKENS_CAP', 'maxTokensCap');
  num('GATEWAY_WS_MAX_CONNECTIONS', 'wsMaxConnections');
  num('GATEWAY_WS_MAX_PER_IP', 'wsMaxPerIp');
  num('GATEWAY_WS_HANDSHAKE_TIMEOUT_MS', 'wsHandshakeTimeoutMs');
  num('GATEWAY_WS_MAX_MESSAGES_PER_SECOND', 'wsMaxMessagesPerSecond');
  num('GATEWAY_WS_PING_INTERVAL_MS', 'wsPingIntervalMs');
  if (env.GATEWAY_QUOTA_TIERS) {
    // JSON: {"free":{"dailyJobs":200,"dailyTokens":200000},...}
    out.quotaTiers = JSON.parse(env.GATEWAY_QUOTA_TIERS) as Record<string, QuotaTier>;
  }
  if (env.GATEWAY_BANNED_PATTERNS) {
    // Comma-separated regex sources, applied case-insensitively.
    out.bannedPatterns = env.GATEWAY_BANNED_PATTERNS.split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => new RegExp(p, 'i'));
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    hardening: hardeningFromEnv(env),
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
    batchFlushThreshold: Number(env.GATEWAY_BATCH_FLUSH_THRESHOLD ?? '25'),
    batchFlushIntervalSeconds: Number(env.GATEWAY_BATCH_FLUSH_INTERVAL_SECONDS ?? '60'),
    sessionDeadlineMarginSeconds: Number(env.GATEWAY_SESSION_DEADLINE_MARGIN_SECONDS ?? '240'),
    ...(env.GATEWAY_DB_PATH ? { dbPath: env.GATEWAY_DB_PATH } : {}),
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
