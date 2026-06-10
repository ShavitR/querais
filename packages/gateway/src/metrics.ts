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
    '# HELP querais_nodes Connected nodes in the pool.',
    '# TYPE querais_nodes gauge',
    `querais_nodes ${nodes}`,
  ];
  return lines.join('\n') + '\n';
}
