import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Histogram, LATENCY_BUCKETS, metrics, renderMetrics } from './metrics.js';

test('Histogram: cumulative buckets, +Inf, sum and count', () => {
  const h = new Histogram(LATENCY_BUCKETS);
  h.observe(0.3); // le 0.5
  h.observe(0.5); // le 0.5 (boundary is inclusive)
  h.observe(4); // le 5
  h.observe(500); // overflow → +Inf only
  const lines = h.render('x_seconds', 'help');
  assert.ok(lines.includes('x_seconds_bucket{le="0.5"} 2'));
  assert.ok(lines.includes('x_seconds_bucket{le="2.5"} 2'), 'cumulative carries forward');
  assert.ok(lines.includes('x_seconds_bucket{le="5"} 3'));
  assert.ok(lines.includes('x_seconds_bucket{le="120"} 3'), 'overflow not in finite buckets');
  assert.ok(lines.includes('x_seconds_bucket{le="+Inf"} 4'));
  assert.ok(lines.includes('x_seconds_sum 504.8'));
  assert.ok(lines.includes('x_seconds_count 4'));
});

test('renderMetrics emits valid Prometheus text with the Slice 8 surface', () => {
  metrics.jobsSettledByModel['llama-3.2-1b'] = 7;
  metrics.tokensServedByModel['llama-3.2-1b'] = 1234;
  metrics.gasBalanceWei = 5e17;
  metrics.faucetQais = 42.5;
  const out = renderMetrics({
    nodes: 3,
    pendingDebits: 2,
    pendingDebitValueQais: 0.25,
    oldestPendingDebitAgeSeconds: 17,
    openFlags: 1,
    keepers: [{ name: 'flush', lastSuccessAt: 1_000 }],
  });

  // Line-format sanity: every non-comment line is `name[{labels}] value`.
  for (const line of out.trimEnd().split('\n')) {
    if (line.startsWith('#')) continue;
    assert.match(line, /^[a-z_]+(\{[^}]+\})? -?[\d.e+]+$/i, `bad exposition line: ${line}`);
  }
  // Every metric family has HELP + TYPE.
  for (const line of out.split('\n')) {
    const m = /^querais_[a-z_]+/.exec(line);
    if (!m || line.startsWith('#')) continue;
    const family = m[0].replace(/_(bucket|sum|count)$/, '');
    assert.ok(out.includes(`# TYPE ${family} `), `missing TYPE for ${family}`);
  }

  assert.ok(out.includes('querais_jobs_settled_total{model="llama-3.2-1b"} 7'));
  assert.ok(out.includes('querais_tokens_served_total{model="llama-3.2-1b"} 1234'));
  assert.ok(out.includes('querais_job_duration_seconds_bucket{le="+Inf"}'));
  assert.ok(out.includes('querais_job_ttft_seconds_count'));
  assert.ok(out.includes('querais_pending_debits 2'));
  assert.ok(out.includes('querais_pending_debit_value_qais 0.25'));
  assert.ok(out.includes('querais_oldest_pending_debit_age_seconds 17'));
  assert.ok(out.includes('querais_open_flags 1'));
  assert.ok(out.includes('querais_keeper_last_success_timestamp{keeper="flush"} 1000'));
  assert.ok(out.includes('querais_gas_balance_wei 500000000000000000'));
  assert.ok(out.includes('querais_faucet_qais 42.5'));
  assert.ok(out.includes('querais_nodes 3'), 'legacy gauge name still emitted (Slice 9 removes)');
  assert.ok(out.includes('querais_nodes_connected 3'));

  // A bare node count (legacy callers) still renders, omitting the optional gauges.
  const bare = renderMetrics(5);
  assert.ok(bare.includes('querais_nodes_connected 5'));
  assert.ok(!bare.includes('querais_pending_debits'));
});
