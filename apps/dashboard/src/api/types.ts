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
