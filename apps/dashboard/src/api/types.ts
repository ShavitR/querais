/**
 * Hand-written mirrors of the gateway's `/v1/*` response shapes (the gateway has no
 * OpenAPI emit; these are the single source of truth on the client). Keep in sync with
 * the corresponding `packages/gateway/src/routes/*.ts` handlers.
 */

/** GET /v1/stats — public network snapshot. */
export interface Stats {
  nodes: number;
  models: string[];
  treasury: { address: string; balanceQais: string };
  jobs: { created: number; settled: number; failed: number; tokensServed: number };
}

/** One served model advertised by a node. */
export interface NodeModel {
  model: string;
  pricePerTokenWei: string;
  tokensPerSecond: number;
}

/** The 5-dimension reputation breakdown (each 0..1), Slice 4. */
export interface ReputationDimensions {
  accuracy: number;
  uptime: number;
  latency: number;
  longevity: number;
  stake: number;
}

/** GET /v1/nodes — one entry per known node. */
export interface NodeInfo {
  wallet: string;
  nodeId: string;
  reputation: number;
  dimensions: ReputationDimensions;
  flags: number;
  claimableRewardsWei: string;
  jobsServed: number;
  models: NodeModel[];
}

export interface NodesResponse {
  object: 'list';
  data: NodeInfo[];
}

/** GET /v1/status — public health (5s cached server-side). */
export interface Status {
  status: 'ok' | 'degraded' | 'down';
  nodes: number;
  rpcOk: boolean;
  jobs24h: number;
  lastSettlementAgeSeconds: number | null;
  uptimeSeconds: number;
  openIncidents: number;
}

/** GET /v1/usage — per-requester usage (cookie- or bearer-authenticated). */
export interface Usage {
  wallet: string;
  jobsServed: number;
  tokensServed: number;
  qaisSpentWei: string;
}

/** The signed-in principal, from GET /v1/auth/me (cookie). */
export interface Me {
  wallet: string;
  tier: string;
}

/** One row from GET /v1/jobs (the requester's recent jobs, DB mirror). */
export interface JobListItem {
  jobId: string;
  status: 'assigned' | 'verified' | 'failed';
  model: string;
  provider: string;
  maxTokens: number;
  actualTokens: number | null;
  agreedPricePerToken: string;
  providerPay: string | null;
  protocolFee: string | null;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobsResponse {
  object: 'list';
  data: JobListItem[];
}

/** GET /v1/models — OpenAI-shaped model list. */
export interface ModelsResponse {
  object: 'list';
  data: { id: string; object: 'model'; owned_by: string }[];
}

/** GET /v1/credit/info — chain bindings (also gives us the chainId for explorer links). */
export interface CreditInfo {
  chainId: number;
  creditAccount: string;
  token: string;
  settler: string;
}
