import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import pino from 'pino';
import { GatewayDb } from '../db/index.js';
import { JobStore } from '../db/jobs.js';
import { NodeReputationStore } from '../db/node-reputation.js';
import { NodeSessionStore } from '../db/node-sessions.js';
import { ReputationSnapshotStore } from '../db/reputation-snapshots.js';
import { LayerACheckStore } from '../db/layer-a-checks.js';
import { NodeFlagStore } from '../db/node-flags.js';
import { ReputationService } from '../reputation.js';
import { AlertService, MemorySink } from '../alerts.js';
import { metrics } from '../metrics.js';
import type { ChainClient } from '../chain-client.js';
import type { NodePool } from '../node-pool.js';
import { cosineSimilarity, type EmbeddingProvider } from './embeddings.js';
import {
  classifySimilarityBps,
  LayerASampler,
  type OracleInference,
  type SampleContext,
} from './layer-a.js';

const logger = pino({ level: 'silent' });
const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const JOB = ('0x' + '11'.repeat(32)) as Hex;

// ── pure boundaries ───────────────────────────────────────────────────────────────

test('cosineSimilarity: identical, orthogonal, opposite, and degenerate inputs', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([], []), 0, 'empty vectors');
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0, 'length mismatch');
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0, 'zero vector');
});

test('classifySimilarityBps follows the spec thresholds exactly (0.70 / 0.85)', () => {
  assert.equal(classifySimilarityBps(10000), 'pass');
  assert.equal(classifySimilarityBps(8500), 'pass'); // ≥ 0.85
  assert.equal(classifySimilarityBps(8499), 'soft');
  assert.equal(classifySimilarityBps(7000), 'soft'); // ≥ 0.70
  assert.equal(classifySimilarityBps(6999), 'anomaly');
  assert.equal(classifySimilarityBps(0), 'anomaly');
});

// ── sampler fixture ───────────────────────────────────────────────────────────────

/** Embeds by trigram counts — real cosine behavior without a model: identical text →
 *  1.0, unrelated text → near 0. The e2e mock uses the same approach. */
function trigramEmbeddings(): EmbeddingProvider {
  return {
    async embed(text: string): Promise<number[]> {
      const v = new Array<number>(64).fill(0);
      const s = text.toLowerCase();
      for (let i = 0; i + 3 <= s.length; i++) {
        let h = 0;
        for (let j = i; j < i + 3; j++) h = (h * 31 + s.charCodeAt(j)) >>> 0;
        v[h % 64]! += 1;
      }
      return v;
    },
  };
}

function fixture(oracleOutput: string, opts?: { sampleRate?: number; oracleRuns?: number }) {
  const db = new GatewayDb();
  const accuracy = new NodeReputationStore(db);
  const reputation = new ReputationService(
    {
      getNode: async () => ({ registeredAt: 0n, stakeAmount: 0n, exists: true }),
    } as unknown as ChainClient,
    accuracy,
    new NodeSessionStore(db),
    new JobStore(db),
    new ReputationSnapshotStore(db),
    logger,
  );
  const checks = new LayerACheckStore(db);
  const flags = new NodeFlagStore(db);
  let oracleCalls = 0;
  const inference: OracleInference = {
    generate: async () => {
      oracleCalls += 1;
      return oracleOutput;
    },
  };
  let refreshed = 0;
  const pool = { refreshReputation: async () => void (refreshed += 1) } as unknown as NodePool;
  // Slice 8: anomalies must page — captured by a MemorySink.
  const alertSink = new MemorySink();
  const alerts = new AlertService(alertSink, logger, { cooldownSeconds: 0, minSeverity: 'warn' });
  const sampler = new LayerASampler(
    inference,
    trigramEmbeddings(),
    checks,
    flags,
    reputation,
    pool,
    logger,
    { sampleRate: opts?.sampleRate ?? 1, oracleRuns: opts?.oracleRuns ?? 2 },
    () => 0, // deterministic: always inside the sample
    undefined,
    alerts,
  );
  return {
    sampler,
    checks,
    flags,
    accuracy,
    alerts: alertSink.alerts,
    oracleCalls: () => oracleCalls,
    refreshed: () => refreshed,
  };
}

function ctx(output: string): SampleContext {
  return {
    jobId: JOB,
    provider: NODE,
    model: 'mock-model',
    messages: [{ role: 'user', content: 'what is the capital of France?' }],
    maxTokens: 50,
    output,
  };
}

// ── verdict paths ─────────────────────────────────────────────────────────────────

test('matching outputs pass: check recorded, no EMA hit, no flag', async () => {
  const honest = 'The capital of France is Paris, of course.';
  const f = fixture(honest);
  const verdict = await f.sampler.run(ctx(honest));
  assert.equal(verdict, 'pass');
  assert.equal(f.checks.get(JOB)?.verdict, 'pass');
  assert.equal(f.checks.get(JOB)?.similarityBps, 10000);
  assert.equal(f.oracleCalls(), 2, 'both oracle runs executed');
  assert.equal(f.accuracy.get(NODE), undefined, 'pass does not touch the EMA (no double count)');
  assert.equal(f.flags.countFor(NODE), 0);
});

test('unrelated output is an anomaly: EMA hit at 0.05, manual-review flag, pool refresh', async () => {
  const failsBefore = metrics.layerAAnomalies;
  const f = fixture('The capital of France is Paris, a beautiful city on the Seine.');
  const verdict = await f.sampler.run(ctx('Buy cheap pills online now!!! Click here for deals.'));
  assert.equal(verdict, 'anomaly');
  assert.equal(f.checks.get(JOB)?.verdict, 'anomaly');
  // 7000 → one oracle-anomaly step (α=0.05): 6650.
  assert.equal(f.accuracy.get(NODE)?.accuracyBps, 6650);
  assert.equal(f.flags.countFor(NODE), 1, 'anomaly lands on the manual-review ledger');
  assert.equal(f.flags.forWallet(NODE)[0]?.kind, 'layer-a:anomaly');
  assert.equal(f.refreshed(), 1, 'matching sees the new composite');
  assert.equal(metrics.layerAAnomalies, failsBefore + 1);
  // Slice 8: the anomaly pages a human at flag time.
  await new Promise((r) => setImmediate(r));
  assert.equal(f.alerts.length, 1, 'anomaly raised a push alert');
  assert.equal(f.alerts[0]?.rule, 'layer-a-anomaly');
  assert.equal(f.alerts[0]?.severity, 'critical');
  assert.equal(f.alerts[0]?.key, `layer-a-anomaly:${NODE.toLowerCase()}`);
  assert.match(f.alerts[0]?.detail ?? '', new RegExp(JOB));
});

test('pass and soft verdicts never page', async () => {
  const honest = 'The capital of France is Paris, of course.';
  const f = fixture(honest);
  await f.sampler.run(ctx(honest));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.alerts.length, 0, 'a passing sample must not alert');
});

test('the best oracle run decides (2-of-N redundancy: one agreeing run clears the node)', async () => {
  const honest = 'The capital of France is Paris.';
  let call = 0;
  const f = fixture(honest);
  // First oracle run returns garbage (bad oracle node), second agrees with the provider.
  (f.sampler as unknown as { inference: OracleInference }).inference = {
    generate: async () => (call++ === 0 ? 'zzz qqq xxx unrelated nonsense' : honest),
  };
  const verdict = await f.sampler.run(ctx(honest));
  assert.equal(verdict, 'pass', 'max similarity across runs is used');
});

test('anomaly + dispute hook: raises and auto-resolves; a chain failure never loses the flag', async () => {
  const disputesBefore = metrics.layerADisputes;
  const raised: Array<{ jobId: Hex; defendant: Address }> = [];
  const f = fixture('The capital of France is Paris.');
  (f.sampler as unknown as { disputes: unknown }).disputes = {
    raiseAndAutoResolve: async (jobId: Hex, defendant: Address) =>
      void raised.push({ jobId, defendant }),
  };
  await f.sampler.run(ctx('Buy cheap pills online now!!! Click here.'));
  assert.deepEqual(raised, [{ jobId: JOB, defendant: NODE }], 'dispute raised for the anomaly');
  assert.equal(metrics.layerADisputes, disputesBefore + 1);

  // A failing chain hook must not throw out of run() nor remove the durable flag.
  const g = fixture('The capital of France is Paris.');
  (g.sampler as unknown as { disputes: unknown }).disputes = {
    raiseAndAutoResolve: async () => {
      throw new Error('rpc down');
    },
  };
  const verdict = await g.sampler.run(ctx('Completely unrelated spam output here.'));
  assert.equal(verdict, 'anomaly');
  assert.equal(g.flags.countFor(NODE), 1, 'the manual-review flag survives the chain failure');
});

test('maybeSample respects the sample rate and never throws on oracle failure', async () => {
  const f = fixture('whatever', { sampleRate: 0 });
  f.sampler.maybeSample(ctx('anything'));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.oracleCalls(), 0, 'rate 0 never samples');

  const failuresBefore = metrics.layerAFailures;
  const g = fixture('unused');
  (g.sampler as unknown as { inference: OracleInference }).inference = {
    generate: async () => {
      throw new Error('oracle down');
    },
  };
  g.sampler.maybeSample(ctx('anything')); // must not reject/throw
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(metrics.layerAFailures, failuresBefore + 1, 'failure counted, not thrown');
  assert.equal(g.checks.get(JOB), undefined, 'no verdict recorded on failure');
});
