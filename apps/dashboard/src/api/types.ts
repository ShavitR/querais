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

/** GET /v1/sessions — the live session/credit/headroom view (Slice 2 / 3B). */
export interface SessionStatus {
  requester: string;
  settler: string;
  session: {
    nonce: string;
    maxSpendWei: string;
    deadline: string;
    spentAgainstWei: string;
    capRemainingWei: string;
  } | null;
  credit: { balanceWei: string };
  pendingDebits: { count: number; totalWei: string };
  headroomWei: string | null;
}

/** The signed spending cap as POSTed to /v1/sessions (bigints as decimal strings). */
export interface SignedCapWire {
  requester: string;
  settler: string;
  maxSpendWei: string;
  nonce: string;
  deadline: string;
  signature: string;
}

// ── Slice 10C: operator console + admin review queue ──────────────────────────

export type LayerAVerdict = 'pass' | 'soft' | 'anomaly';

/** One on-chain reputation snapshot row (bps = basis points of [0,1]). */
export interface ReputationSnapshot {
  wallet: string;
  compositeBps: number;
  accuracyBps: number;
  uptimeBps: number;
  latencyBps: number;
  longevityBps: number;
  stakeBps: number;
  txHash: string;
  flagged: boolean;
  createdAt: number;
}

/** A Layer-A verdict (hashes/scores only — never prompt text). */
export interface LayerAVerdictRow {
  jobId: string;
  provider: string;
  similarityBps: number;
  verdict: LayerAVerdict;
  oracleRuns: number;
  createdAt: number;
}

/** A manual-review flag against a node. */
export interface NodeFlag {
  id: number;
  wallet: string;
  kind: string;
  detail: string;
  createdAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}

/** GET /v1/operator/overview — the signed-in node's own data. */
export interface OperatorOverview {
  wallet: string;
  connected: boolean;
  jobsServed: number | null;
  models: { model: string; pricePerTokenWei: string; tokensPerSecond: number }[];
  claimableRewardsWei: string;
  reputation: {
    composite: number;
    accuracy: number;
    uptime: number;
    latency: number;
    longevity: number;
    stake: number;
  };
  reputationHistory: ReputationSnapshot[];
  flags: NodeFlag[];
  recentVerdicts: LayerAVerdictRow[];
  ttftMs: number[];
}

/** A flag enriched with the Layer-A verdicts behind it (admin queue). */
export interface AdminFlag extends NodeFlag {
  relatedVerdicts: LayerAVerdictRow[];
}

export interface AdminFlagsResponse {
  flags: AdminFlag[];
  openCount: number;
}

/** GET /v1/disputes/:jobId — a job's on-chain dispute (Slice 10C-2). */
export interface DisputeView {
  jobId: string;
  status: string; // none | open | countered | resolved
  challenger: string;
  defendant: string;
  bondWei: string;
  evidenceHash: string;
  counterEvidenceHash: string;
  raisedAt: number;
  counterEvidenceDeadline: number;
  challengerWon: boolean;
}
