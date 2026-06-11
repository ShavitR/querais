/**
 * Minimal in-process metrics (no extra dependency) exposed at /metrics in
 * Prometheus text format. The dispatcher increments these as jobs flow through.
 */
export const metrics = {
  jobsCreated: 0,
  jobsSettled: 0,
  jobsFailed: 0,
  tokensServed: 0,
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
  // Slice 6A: treasury epoch sweeps.
  treasuryDistributions: 0,
  treasuryDistributeFailures: 0,
};

/** Render the Prometheus exposition, plus a live gauge for connected nodes. */
export function renderMetrics(nodes: number): string {
  const lines = [
    '# HELP querais_jobs_created_total Jobs created (locked) on-chain.',
    '# TYPE querais_jobs_created_total counter',
    `querais_jobs_created_total ${metrics.jobsCreated}`,
    '# HELP querais_jobs_settled_total Jobs verified and settled.',
    '# TYPE querais_jobs_settled_total counter',
    `querais_jobs_settled_total ${metrics.jobsSettled}`,
    '# HELP querais_jobs_failed_total Jobs that failed verification.',
    '# TYPE querais_jobs_failed_total counter',
    `querais_jobs_failed_total ${metrics.jobsFailed}`,
    '# HELP querais_tokens_served_total Total completion tokens settled.',
    '# TYPE querais_tokens_served_total counter',
    `querais_tokens_served_total ${metrics.tokensServed}`,
    '# HELP querais_reputation_snapshots_total Reputation scores published on-chain.',
    '# TYPE querais_reputation_snapshots_total counter',
    `querais_reputation_snapshots_total ${metrics.reputationSnapshots}`,
    '# HELP querais_reputation_publish_failures_total Failed on-chain reputation publishes.',
    '# TYPE querais_reputation_publish_failures_total counter',
    `querais_reputation_publish_failures_total ${metrics.reputationPublishFailures}`,
    '# HELP querais_reputation_flags_total Nodes flagged for manual review (rapid decline).',
    '# TYPE querais_reputation_flags_total counter',
    `querais_reputation_flags_total ${metrics.reputationFlags}`,
    '# HELP querais_layer_a_samples_total Jobs semantically sampled by the Layer-A oracle.',
    '# TYPE querais_layer_a_samples_total counter',
    `querais_layer_a_samples_total ${metrics.layerASamples}`,
    '# HELP querais_layer_a_anomalies_total Layer-A similarity anomalies (<0.70).',
    '# TYPE querais_layer_a_anomalies_total counter',
    `querais_layer_a_anomalies_total ${metrics.layerAAnomalies}`,
    '# HELP querais_layer_a_failures_total Layer-A sampling attempts that errored.',
    '# TYPE querais_layer_a_failures_total counter',
    `querais_layer_a_failures_total ${metrics.layerAFailures}`,
    '# HELP querais_layer_a_disputes_total On-chain disputes raised + auto-resolved (5B).',
    '# TYPE querais_layer_a_disputes_total counter',
    `querais_layer_a_disputes_total ${metrics.layerADisputes}`,
    '# HELP querais_pattern_flags_total Output-pattern cheater flags (manual review).',
    '# TYPE querais_pattern_flags_total counter',
    `querais_pattern_flags_total ${metrics.patternFlags}`,
    '# HELP querais_treasury_distributions_total Treasury 60/20/20 sweeps executed.',
    '# TYPE querais_treasury_distributions_total counter',
    `querais_treasury_distributions_total ${metrics.treasuryDistributions}`,
    '# HELP querais_treasury_distribute_failures_total Failed treasury sweeps.',
    '# TYPE querais_treasury_distribute_failures_total counter',
    `querais_treasury_distribute_failures_total ${metrics.treasuryDistributeFailures}`,
    '# HELP querais_nodes Connected nodes in the pool.',
    '# TYPE querais_nodes gauge',
    `querais_nodes ${nodes}`,
  ];
  return lines.join('\n') + '\n';
}
