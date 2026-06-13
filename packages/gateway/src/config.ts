import { parseEther, type Address, type Hex } from 'viem';
import type { IncentiveConfig } from './incentives.js';
import type { AlertSeverity, WebhookFormat } from './alerts.js';

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

/** Slice 5 Layer-A oracle knobs. Sampling stays off unless oracle inference exists
 *  (an `ollamaUrl` here, or seams injected via BuildOptions in tests/e2e). */
export interface LayerAConfig {
  /** Fraction of settled jobs to semantically sample (spec: 0.05). */
  sampleRate: number;
  /** Oracle re-runs per sampled job (spec: 2–3; all must disagree to flag). */
  oracleRuns: number;
  /** Output-pattern sweep cadence (seconds). */
  patternScanIntervalSeconds: number;
  /** Ollama endpoint for oracle re-runs + embeddings (unset → sampler disabled). */
  ollamaUrl?: string;
  /** Embedding model for similarity scoring. */
  embedModel: string;
  /** Slice 5B: also raise + auto-resolve an on-chain dispute on every anomaly
   *  (needs a DisputeResolution deployment + bond funds; flags alone otherwise). */
  disputeOnAnomaly: boolean;
}

export const LAYER_A_DEFAULTS: LayerAConfig = {
  sampleRate: 0.05,
  oracleRuns: 2,
  patternScanIntervalSeconds: 3600,
  embedModel: 'nomic-embed-text',
  disputeOnAnomaly: false,
};

export function resolveLayerA(partial?: Partial<LayerAConfig>): LayerAConfig {
  return { ...LAYER_A_DEFAULTS, ...partial };
}

/** Slice 8 alerting knobs. Everything defaults sane with NO env vars set: alerting is
 *  off (noop sink) until `GATEWAY_ALERT_WEBHOOK_URL` exists; the sweep keeper always
 *  runs (it also refreshes the balance gauges). */
export interface AlertsConfig {
  /** Outbound webhook target; unset → alerting disabled (NoopSink). */
  webhookUrl?: string;
  /** Body shape: 'discord' | 'slack' | 'generic' (raw Alert JSON). */
  webhookFormat: WebhookFormat;
  /** Alerts below this severity are metric+log only. */
  minSeverity: AlertSeverity;
  /** Per-alert-key suppression window. */
  cooldownSeconds: number;
  /** Sweep-rule keeper cadence (gas, stuck debits, keeper health, …). */
  sweepIntervalSeconds: number;
  /** `gas-low` fires when the hot wallet's ETH drops below this. */
  gasMinWei: bigint;
  /** `stuck-debits` fires when the oldest unflushed debit is older than this. */
  debitMaxAgeSeconds: number;
  /** `settlement-failures` fires at this many consecutive flush failures. */
  settleFailStreak: number;
}

export const ALERTS_DEFAULTS: AlertsConfig = {
  webhookFormat: 'generic',
  minSeverity: 'warn',
  cooldownSeconds: 3600,
  sweepIntervalSeconds: 60,
  gasMinWei: 10n ** 16n, // 0.01 ETH
  debitMaxAgeSeconds: 900,
  settleFailStreak: 3,
};

export function resolveAlerts(partial?: Partial<AlertsConfig>): AlertsConfig {
  return { ...ALERTS_DEFAULTS, ...partial };
}

// Slice 6C incentive knobs live in gateway/src/incentives.ts (INCENTIVE_DEFAULTS);
// the env overrides are parsed here alongside the other groups.

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
  /** Slice 9: path to the operator's signed-model-manifest JSON file. Unset = no
   *  digest enforcement (Slice 8 behavior). Invalid file = fail fast at boot. */
  modelManifestPath?: string;
  /** Slice 10A: directory of the built web app (apps/dashboard/dist) served at /. Unset =
   *  resolved by walking up from the gateway package; an absent dir = boot-safe fallback. */
  dashboardDir?: string;
  /** Slice 10A: HMAC secret for stateless session cookies. Unset = derived from privateKey
   *  (so dev/e2e need no extra env; production sets it explicitly to survive key rotation). */
  sessionSecret?: string;
  /** Slice 10A: session-cookie lifetime in seconds (default 86400). */
  sessionTtlSeconds?: number;
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
  /** Slice 4B: publish every known node's composite reputation on-chain at this
   *  interval (the spec's daily epoch snapshot; e2e shrinks it to seconds). */
  reputationSnapshotIntervalSeconds: number;
  /** Slice 6A: sweep the treasury (60/20/20 distribute()) at this interval; runs only
   *  when the deployment has a ProtocolTreasury contract. */
  treasuryDistributeIntervalSeconds: number;
  /** Slice 3: surface-hardening overrides (faucet throttles, quota tiers, prompt limits,
   *  WS caps). Unset fields fall back to HARDENING_DEFAULTS. */
  hardening?: Partial<HardeningConfig>;
  /** Slice 5: Layer-A oracle overrides. Unset fields fall back to LAYER_A_DEFAULTS. */
  layerA?: Partial<LayerAConfig>;
  /** Slice 6C: incentive-program overrides. Unset fields fall back to INCENTIVE_DEFAULTS. */
  incentives?: Partial<IncentiveConfig>;
  /** Slice 8: alerting overrides. Unset fields fall back to ALERTS_DEFAULTS. */
  alerts?: Partial<AlertsConfig>;
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

/** Read any GATEWAY_* Layer-A overrides present in the environment. */
function layerAFromEnv(env: NodeJS.ProcessEnv): Partial<LayerAConfig> {
  const out: Partial<LayerAConfig> = {};
  if (env.GATEWAY_LAYER_A_SAMPLE_RATE) out.sampleRate = Number(env.GATEWAY_LAYER_A_SAMPLE_RATE);
  if (env.GATEWAY_LAYER_A_ORACLE_RUNS) out.oracleRuns = Number(env.GATEWAY_LAYER_A_ORACLE_RUNS);
  if (env.GATEWAY_PATTERN_SCAN_INTERVAL_SECONDS) {
    out.patternScanIntervalSeconds = Number(env.GATEWAY_PATTERN_SCAN_INTERVAL_SECONDS);
  }
  if (env.GATEWAY_ORACLE_OLLAMA_URL) out.ollamaUrl = env.GATEWAY_ORACLE_OLLAMA_URL;
  if (env.GATEWAY_ORACLE_EMBED_MODEL) out.embedModel = env.GATEWAY_ORACLE_EMBED_MODEL;
  if (env.GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY) {
    out.disputeOnAnomaly = env.GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY === 'true';
  }
  return out;
}

/** Read any GATEWAY_ALERT_* overrides present in the environment. */
function alertsFromEnv(env: NodeJS.ProcessEnv): Partial<AlertsConfig> {
  const out: Partial<AlertsConfig> = {};
  if (env.GATEWAY_ALERT_WEBHOOK_URL) out.webhookUrl = env.GATEWAY_ALERT_WEBHOOK_URL;
  if (env.GATEWAY_ALERT_WEBHOOK_FORMAT) {
    const f = env.GATEWAY_ALERT_WEBHOOK_FORMAT;
    if (f !== 'discord' && f !== 'slack' && f !== 'generic') {
      throw new Error(`GATEWAY_ALERT_WEBHOOK_FORMAT must be discord|slack|generic, got "${f}"`);
    }
    out.webhookFormat = f;
  }
  if (env.GATEWAY_ALERT_MIN_SEVERITY) {
    const s = env.GATEWAY_ALERT_MIN_SEVERITY;
    if (s !== 'info' && s !== 'warn' && s !== 'critical') {
      throw new Error(`GATEWAY_ALERT_MIN_SEVERITY must be info|warn|critical, got "${s}"`);
    }
    out.minSeverity = s;
  }
  if (env.GATEWAY_ALERT_COOLDOWN_SECONDS) {
    out.cooldownSeconds = Number(env.GATEWAY_ALERT_COOLDOWN_SECONDS);
  }
  if (env.GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS) {
    out.sweepIntervalSeconds = Number(env.GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS);
  }
  if (env.GATEWAY_ALERT_GAS_MIN_WEI) out.gasMinWei = BigInt(env.GATEWAY_ALERT_GAS_MIN_WEI);
  if (env.GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS) {
    out.debitMaxAgeSeconds = Number(env.GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS);
  }
  if (env.GATEWAY_ALERT_SETTLE_FAIL_STREAK) {
    out.settleFailStreak = Number(env.GATEWAY_ALERT_SETTLE_FAIL_STREAK);
  }
  return out;
}

/** Read any GATEWAY_INCENTIVE_* overrides present in the environment. */
function incentivesFromEnv(env: NodeJS.ProcessEnv): Partial<IncentiveConfig> {
  const out: Record<string, number> = {};
  const num = (key: string, field: string) => {
    if (env[key] !== undefined && env[key] !== '') out[field] = Number(env[key]);
  };
  num('GATEWAY_INCENTIVE_UPTIME_POOL_QAIS', 'uptimePoolQais');
  num('GATEWAY_INCENTIVE_UPTIME_THRESHOLD_BPS', 'uptimeThresholdBps');
  num('GATEWAY_INCENTIVE_FIRST_MODEL_QAIS', 'firstModelBonusQais');
  num('GATEWAY_INCENTIVE_BOOTSTRAP_QAIS', 'bootstrapBonusQais');
  num('GATEWAY_INCENTIVE_BOOTSTRAP_MAX_NODES', 'bootstrapMaxNodes');
  num('GATEWAY_INCENTIVE_BOOTSTRAP_MIN_TENURE_DAYS', 'bootstrapMinTenureDays');
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    hardening: hardeningFromEnv(env),
    layerA: layerAFromEnv(env),
    incentives: incentivesFromEnv(env),
    alerts: alertsFromEnv(env),
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
    reputationSnapshotIntervalSeconds: Number(
      env.GATEWAY_REPUTATION_SNAPSHOT_INTERVAL_SECONDS ?? '86400',
    ),
    treasuryDistributeIntervalSeconds: Number(
      env.GATEWAY_TREASURY_DISTRIBUTE_INTERVAL_SECONDS ?? '86400',
    ),
    sessionTtlSeconds: Number(env.GATEWAY_SESSION_TTL_SECONDS ?? '86400'),
    ...(env.GATEWAY_DASHBOARD_DIR ? { dashboardDir: env.GATEWAY_DASHBOARD_DIR } : {}),
    ...(env.GATEWAY_SESSION_SECRET ? { sessionSecret: env.GATEWAY_SESSION_SECRET } : {}),
    ...(env.GATEWAY_DB_PATH ? { dbPath: env.GATEWAY_DB_PATH } : {}),
    ...(env.GATEWAY_ADMIN_TOKEN ? { adminToken: env.GATEWAY_ADMIN_TOKEN } : {}),
    faucetAmountWei: env.GATEWAY_FAUCET_AMOUNT_WEI
      ? BigInt(env.GATEWAY_FAUCET_AMOUNT_WEI)
      : parseEther('5000'),
    faucetEthWei: env.GATEWAY_FAUCET_ETH_WEI ? BigInt(env.GATEWAY_FAUCET_ETH_WEI) : 0n,
    ...(env.GATEWAY_FAUCET_PRIVATE_KEY
      ? { faucetPrivateKey: env.GATEWAY_FAUCET_PRIVATE_KEY as Hex }
      : {}),
    ...(env.GATEWAY_MODEL_MANIFEST ? { modelManifestPath: env.GATEWAY_MODEL_MANIFEST } : {}),
  };
}
