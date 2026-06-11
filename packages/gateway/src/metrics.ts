/**
 * Minimal in-process metrics (no extra dependency) exposed at /metrics in
 * Prometheus text format. The dispatcher increments these as jobs flow through.
 */

/** Fixed-bucket histogram (Prometheus `_bucket/_sum/_count` semantics). */
export class Histogram {
  /** Per-bucket (non-cumulative) hit counts; cumulated at render. */
  private readonly hits: number[];
  private overflow = 0; // observations above the last bucket (+Inf only)
  sum = 0;
  count = 0;

  constructor(readonly buckets: readonly number[]) {
    this.hits = new Array<number>(buckets.length).fill(0);
  }

  observe(value: number): void {
    this.sum += value;
    this.count += 1;
    const i = this.buckets.findIndex((b) => value <= b);
    if (i === -1) this.overflow += 1;
    else this.hits[i]! += 1;
  }

  /** Render the metric block. `name` must already carry its unit suffix. */
  render(name: string, help: string): string[] {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.hits[i]!;
      lines.push(`${name}_bucket{le="${String(this.buckets[i])}"} ${String(cumulative)}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${String(this.count)}`);
    lines.push(`${name}_sum ${String(this.sum)}`);
    lines.push(`${name}_count ${String(this.count)}`);
    return lines;
  }
}

/** Latency buckets (seconds) shared by job duration and TTFT. */
export const LATENCY_BUCKETS = [0.5, 1, 2.5, 5, 10, 30, 60, 120] as const;

export const metrics = {
  jobsCreated: 0,
  jobsSettled: 0,
  jobsFailed: 0,
  tokensServed: 0,
  // Slice 8: per-model splits (label set bounded by the model registry) + latency.
  jobsSettledByModel: {} as Record<string, number>,
  tokensServedByModel: {} as Record<string, number>,
  jobDurationSeconds: new Histogram(LATENCY_BUCKETS),
  jobTtftSeconds: new Histogram(LATENCY_BUCKETS),
  // Slice 4B: the reputation oracle's on-chain publishing.
  reputationSnapshots: 0,
  reputationPublishFailures: 0,
  reputationFlags: 0,
  // Slice 5: Layer-A semantic sampling + pattern detection.
  layerASamples: 0,
  layerAAnomalies: 0,
  layerAFailures: 0,
  layerADisputes: 0,
  patternFlags: 0,
  // Slice 6A/6B: treasury epoch sweeps + staking-rewards epoch credits.
  treasuryDistributions: 0,
  treasuryDistributeFailures: 0,
  rewardsEpochs: 0,
  rewardsEpochFailures: 0,
  // Slice 8: the alert pipeline (raise → floor/cooldown → sink delivery).
  alertsRaised: 0,
  alertsDelivered: 0,
  alertsFailed: 0,
  alertsSuppressed: 0,
  alertsRaisedBySeverity: { info: 0, warn: 0, critical: 0 },
  // Slice 8 money gauges, refreshed by the alert sweep (no extra RPC traffic).
  // undefined = not read yet (line omitted from /metrics rather than lying with 0).
  gasBalanceWei: undefined as number | undefined,
  hotWalletQais: undefined as number | undefined,
  faucetQais: undefined as number | undefined,
  faucetEthWei: undefined as number | undefined,
};

/** Scrape-time gauge reads the render can't compute itself (DB/pool state). */
export interface GaugeReads {
  nodes: number;
  pendingDebits?: number;
  pendingDebitValueQais?: number;
  oldestPendingDebitAgeSeconds?: number;
  openFlags?: number;
  keepers?: readonly { name: string; lastSuccessAt: number }[];
}

function counter(name: string, help: string, value: number): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} counter`, `${name} ${String(value)}`];
}

function gauge(name: string, help: string, value: number): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${String(value)}`];
}

/** Render the Prometheus exposition. Accepts a bare node count (legacy callers). */
export function renderMetrics(reads: GaugeReads | number): string {
  const g: GaugeReads = typeof reads === 'number' ? { nodes: reads } : reads;
  const lines: string[] = [
    ...counter(
      'querais_jobs_created_total',
      'Jobs created (locked) on-chain.',
      metrics.jobsCreated,
    ),
    '# HELP querais_jobs_settled_total Jobs verified and settled.',
    '# TYPE querais_jobs_settled_total counter',
    `querais_jobs_settled_total ${String(metrics.jobsSettled)}`,
    ...Object.entries(metrics.jobsSettledByModel).map(
      ([model, n]) => `querais_jobs_settled_total{model="${model}"} ${String(n)}`,
    ),
    ...counter('querais_jobs_failed_total', 'Jobs that failed verification.', metrics.jobsFailed),
    '# HELP querais_tokens_served_total Total completion tokens settled.',
    '# TYPE querais_tokens_served_total counter',
    `querais_tokens_served_total ${String(metrics.tokensServed)}`,
    ...Object.entries(metrics.tokensServedByModel).map(
      ([model, n]) => `querais_tokens_served_total{model="${model}"} ${String(n)}`,
    ),
    ...metrics.jobDurationSeconds.render(
      'querais_job_duration_seconds',
      'End-to-end job duration (match through settle).',
    ),
    ...metrics.jobTtftSeconds.render('querais_job_ttft_seconds', 'Time to first streamed token.'),
    ...counter(
      'querais_reputation_snapshots_total',
      'Reputation scores published on-chain.',
      metrics.reputationSnapshots,
    ),
    ...counter(
      'querais_reputation_publish_failures_total',
      'Failed on-chain reputation publishes.',
      metrics.reputationPublishFailures,
    ),
    ...counter(
      'querais_reputation_flags_total',
      'Nodes flagged for manual review (rapid decline).',
      metrics.reputationFlags,
    ),
    ...counter(
      'querais_layer_a_samples_total',
      'Jobs semantically sampled by the Layer-A oracle.',
      metrics.layerASamples,
    ),
    ...counter(
      'querais_layer_a_anomalies_total',
      'Layer-A similarity anomalies (<0.70).',
      metrics.layerAAnomalies,
    ),
    ...counter(
      'querais_layer_a_failures_total',
      'Layer-A sampling attempts that errored.',
      metrics.layerAFailures,
    ),
    ...counter(
      'querais_layer_a_disputes_total',
      'On-chain disputes raised + auto-resolved (5B).',
      metrics.layerADisputes,
    ),
    ...counter(
      'querais_pattern_flags_total',
      'Output-pattern cheater flags (manual review).',
      metrics.patternFlags,
    ),
    ...counter(
      'querais_treasury_distributions_total',
      'Treasury 60/20/20 sweeps executed.',
      metrics.treasuryDistributions,
    ),
    ...counter(
      'querais_treasury_distribute_failures_total',
      'Failed treasury sweeps.',
      metrics.treasuryDistributeFailures,
    ),
    ...counter(
      'querais_rewards_epochs_total',
      'Staking-rewards epoch credits executed.',
      metrics.rewardsEpochs,
    ),
    ...counter(
      'querais_rewards_epoch_failures_total',
      'Failed staking-rewards epoch credits.',
      metrics.rewardsEpochFailures,
    ),
    '# HELP querais_alerts_raised_total Alerts raised, before the severity floor/cooldown.',
    '# TYPE querais_alerts_raised_total counter',
    `querais_alerts_raised_total{severity="info"} ${String(metrics.alertsRaisedBySeverity.info)}`,
    `querais_alerts_raised_total{severity="warn"} ${String(metrics.alertsRaisedBySeverity.warn)}`,
    `querais_alerts_raised_total{severity="critical"} ${String(metrics.alertsRaisedBySeverity.critical)}`,
    ...counter(
      'querais_alerts_delivered_total',
      'Alerts successfully delivered to the sink.',
      metrics.alertsDelivered,
    ),
    ...counter(
      'querais_alerts_failed_total',
      'Alert deliveries that errored.',
      metrics.alertsFailed,
    ),
    ...counter(
      'querais_alerts_suppressed_total',
      'Alerts dropped by the severity floor or cooldown.',
      metrics.alertsSuppressed,
    ),
    // Legacy name — scrapes predating Slice 8 use it. Remove in Slice 9.
    ...gauge('querais_nodes', 'Connected nodes in the pool (legacy name).', g.nodes),
    ...gauge('querais_nodes_connected', 'Connected nodes in the pool.', g.nodes),
  ];
  if (g.pendingDebits !== undefined) {
    lines.push(
      ...gauge('querais_pending_debits', 'Unflushed signed debits in the ledger.', g.pendingDebits),
    );
  }
  if (g.pendingDebitValueQais !== undefined) {
    lines.push(
      ...gauge(
        'querais_pending_debit_value_qais',
        'Outstanding liability: QAIS owed to providers, not yet settled.',
        g.pendingDebitValueQais,
      ),
    );
  }
  if (g.oldestPendingDebitAgeSeconds !== undefined) {
    lines.push(
      ...gauge(
        'querais_oldest_pending_debit_age_seconds',
        'Age of the oldest unflushed debit (0 when none).',
        g.oldestPendingDebitAgeSeconds,
      ),
    );
  }
  if (g.openFlags !== undefined) {
    lines.push(...gauge('querais_open_flags', 'Unreviewed manual-review flags.', g.openFlags));
  }
  if (g.keepers !== undefined && g.keepers.length > 0) {
    lines.push(
      '# HELP querais_keeper_last_success_timestamp Last successful keeper run (ms epoch).',
      '# TYPE querais_keeper_last_success_timestamp gauge',
      ...g.keepers.map(
        (k) =>
          `querais_keeper_last_success_timestamp{keeper="${k.name}"} ${String(k.lastSuccessAt)}`,
      ),
    );
  }
  if (metrics.gasBalanceWei !== undefined) {
    lines.push(
      ...gauge(
        'querais_gas_balance_wei',
        'Gateway hot-wallet ETH (wei), refreshed by the alert sweep.',
        metrics.gasBalanceWei,
      ),
    );
  }
  if (metrics.hotWalletQais !== undefined) {
    lines.push(
      ...gauge(
        'querais_hot_wallet_qais',
        'Gateway hot-wallet QAIS, refreshed by the alert sweep.',
        metrics.hotWalletQais,
      ),
    );
  }
  if (metrics.faucetQais !== undefined) {
    lines.push(
      ...gauge(
        'querais_faucet_qais',
        'Faucet QAIS balance, refreshed by the alert sweep.',
        metrics.faucetQais,
      ),
    );
  }
  if (metrics.faucetEthWei !== undefined) {
    lines.push(
      ...gauge(
        'querais_faucet_eth_wei',
        'Faucet ETH balance (wei), refreshed by the alert sweep.',
        metrics.faucetEthWei,
      ),
    );
  }
  return lines.join('\n') + '\n';
}
