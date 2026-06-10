import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import pino from 'pino';
import { GatewayDb } from './db/index.js';
import { JobStore } from './db/jobs.js';
import { NodeReputationStore } from './db/node-reputation.js';
import { NodeSessionStore } from './db/node-sessions.js';
import type { ChainClient } from './chain-client.js';
import {
  compositeBps,
  emaReputationBps,
  INITIAL_ACCURACY_BPS,
  latencyGradeBps,
  longevityScoreBps,
  p95,
  PLATINUM_STAKE_WEI,
  ReputationService,
  stakeScoreBps,
  uptimeRatioBps,
} from './reputation.js';

const logger = pino({ level: 'silent' });
const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;

const DAY_MS = 86_400_000;
const QAIS = 10n ** 18n;

// ── accuracy EMA (moved from settlement.test.ts alongside the function) ──────────

test('emaReputationBps nudges up on a pass (alpha=0.005)', () => {
  // 7000*0.995 + 10000*0.005 = 6965 + 50 = 7015
  assert.equal(emaReputationBps(7000, 1, 0.005), 7015);
});

test('emaReputationBps drops faster on a failure (alpha=0.05)', () => {
  // 7000*0.95 + 0 = 6650
  assert.equal(emaReputationBps(7000, 0, 0.05), 6650);
});

test('emaReputationBps clamps to [0, 10000]', () => {
  assert.equal(emaReputationBps(10000, 1, 0.005), 10000);
  assert.equal(emaReputationBps(0, 0, 0.05), 0);
});

// ── latency grading ───────────────────────────────────────────────────────────────

test('latencyGradeBps grades exactly at the spec thresholds', () => {
  assert.equal(latencyGradeBps(0), 10000);
  assert.equal(latencyGradeBps(499), 10000);
  assert.equal(latencyGradeBps(500), 9000);
  assert.equal(latencyGradeBps(999), 9000);
  assert.equal(latencyGradeBps(1000), 7500);
  assert.equal(latencyGradeBps(1999), 7500);
  assert.equal(latencyGradeBps(2000), 5000);
  assert.equal(latencyGradeBps(4999), 5000);
  assert.equal(latencyGradeBps(5000), 2500);
  assert.equal(latencyGradeBps(60_000), 2500);
});

test('latencyGradeBps gives an unmeasured node the benefit of the doubt', () => {
  assert.equal(latencyGradeBps(undefined), 10000);
});

test('p95 picks the 95th-percentile sample (nearest rank)', () => {
  assert.equal(p95([]), undefined);
  assert.equal(p95([1234]), 1234);
  // 20 samples: rank = ceil(0.95·20) = 19 → the 19th smallest (one outlier excluded).
  const twenty = [...Array.from({ length: 19 }, (_, i) => 100 + i), 9999];
  assert.equal(p95(twenty), 118);
  // The outlier dominates once it falls inside the rank.
  assert.equal(p95([100, 9999]), 9999);
});

// ── stake score ───────────────────────────────────────────────────────────────────

test('stakeScoreBps follows the spec examples and saturates at Platinum', () => {
  assert.equal(stakeScoreBps(0n), 0);
  assert.equal(stakeScoreBps(100n * QAIS), 100); // 100 QAIS → 0.01
  assert.equal(stakeScoreBps(1_000n * QAIS), 1000); // 1000 QAIS → 0.10
  assert.equal(stakeScoreBps(10_000n * QAIS), 10000); // 10000 QAIS → 1.00
  assert.equal(stakeScoreBps(20_000n * QAIS), 10000); // capped
  assert.equal(stakeScoreBps(PLATINUM_STAKE_WEI - 1n), 9999);
});

// ── longevity ─────────────────────────────────────────────────────────────────────

test('longevityScoreBps grows linearly to 1.0 over a year', () => {
  const now = 2_000_000_000_000; // ms
  const reg = (daysAgo: number) => Math.floor((now - daysAgo * DAY_MS) / 1000);
  assert.equal(longevityScoreBps(reg(0), now, now), 0);
  assert.equal(longevityScoreBps(reg(36.5), now, now), 1000); // 10% of a year
  assert.equal(longevityScoreBps(reg(182.5), now, now), 5000);
  assert.equal(longevityScoreBps(reg(365), now, now), 10000);
  assert.equal(longevityScoreBps(reg(1000), now, now), 10000); // capped
  assert.equal(longevityScoreBps(0, now, now), 0); // unregistered
});

test('longevityScoreBps decays only after 30 days of inactivity', () => {
  const now = 2_000_000_000_000;
  const reg = Math.floor((now - 365 * DAY_MS) / 1000); // a full year registered
  const inactive = (days: number) => now - days * DAY_MS;
  assert.equal(longevityScoreBps(reg, inactive(0), now), 10000);
  assert.equal(longevityScoreBps(reg, inactive(30), now), 10000); // grace boundary
  // 66.5 inactive days = 36.5 past grace → ×(1 − 36.5/365) = ×0.9
  assert.equal(longevityScoreBps(reg, inactive(66.5), now), 9000);
  assert.equal(longevityScoreBps(reg, inactive(30 + 365), now), 0); // fully decayed
  assert.equal(longevityScoreBps(reg, inactive(1000), now), 0); // floored at 0
});

// ── uptime ────────────────────────────────────────────────────────────────────────

test('uptimeRatioBps: always-connected node scores 1.0', () => {
  const now = 1_000_000_000;
  const windowStart = now - 30 * DAY_MS;
  assert.equal(
    uptimeRatioBps([{ start: windowStart - DAY_MS, end: null }], windowStart, now),
    10000,
  );
});

test('uptimeRatioBps: connected half the window scores 0.5', () => {
  const now = 1_000_000_000_000;
  const windowStart = now - 10 * DAY_MS;
  const intervals = [{ start: windowStart, end: windowStart + 5 * DAY_MS }];
  assert.equal(uptimeRatioBps(intervals, windowStart, now), 5000);
});

test('uptimeRatioBps: an open interval counts up to now', () => {
  const now = 1_000_000_000_000;
  const windowStart = now - 10 * DAY_MS;
  const intervals = [{ start: now - 2 * DAY_MS, end: null }];
  // First seen 2 days ago → observed denominator is 2 days, fully connected.
  assert.equal(uptimeRatioBps(intervals, windowStart, now), 10000);
});

test('uptimeRatioBps: a node first seen mid-window is not penalized for before', () => {
  const now = 1_000_000_000_000;
  const windowStart = now - 10 * DAY_MS;
  // Appeared 4 days ago, connected 2 of those 4 days → 0.5 (not 2/10).
  const intervals = [{ start: now - 4 * DAY_MS, end: now - 2 * DAY_MS }];
  assert.equal(uptimeRatioBps(intervals, windowStart, now), 5000);
});

test('uptimeRatioBps: multiple intervals sum; no sessions yet → 1.0', () => {
  const now = 1_000_000_000_000;
  const windowStart = now - 10 * DAY_MS;
  const intervals = [
    { start: windowStart, end: windowStart + 2 * DAY_MS },
    { start: now - 3 * DAY_MS, end: now },
  ];
  assert.equal(uptimeRatioBps(intervals, windowStart, now), 5000);
  assert.equal(uptimeRatioBps([], windowStart, now), 10000);
});

// ── composite ─────────────────────────────────────────────────────────────────────

test('compositeBps applies the 0.40/0.25/0.15/0.10/0.10 weights', () => {
  assert.equal(
    compositeBps({
      accuracyBps: 10000,
      uptimeBps: 10000,
      latencyBps: 10000,
      longevityBps: 10000,
      stakeBps: 10000,
    }),
    10000,
  );
  assert.equal(
    compositeBps({ accuracyBps: 0, uptimeBps: 0, latencyBps: 0, longevityBps: 0, stakeBps: 0 }),
    0,
  );
  // The spec's "new honest node": 0.40·0.80 + 0.25·0.95 + 0.15·0.90 + 0.10·0.05 + 0.10·0.01
  assert.equal(
    compositeBps({
      accuracyBps: 8000,
      uptimeBps: 9500,
      latencyBps: 9000,
      longevityBps: 500,
      stakeBps: 100,
    }),
    6985,
  );
  // Isolate one weight: only accuracy at 1.0 → 0.40.
  assert.equal(
    compositeBps({ accuracyBps: 10000, uptimeBps: 0, latencyBps: 0, longevityBps: 0, stakeBps: 0 }),
    4000,
  );
});

// ── ReputationService ─────────────────────────────────────────────────────────────

function makeService(node?: { registeredAt: bigint; stakeAmount: bigint }) {
  const db = new GatewayDb();
  const jobs = new JobStore(db);
  const sessions = new NodeSessionStore(db);
  const accuracy = new NodeReputationStore(db);
  let chainReads = 0;
  const chain = {
    getNode: async () => {
      chainReads += 1;
      return {
        registeredAt: node?.registeredAt ?? 0n,
        stakeAmount: node?.stakeAmount ?? 0n,
        // A poisoned on-chain score: accuracy must NEVER be seeded from it.
        reputationScore: 1234n,
        exists: true,
        isActive: true,
      };
    },
  } as unknown as ChainClient;
  const service = new ReputationService(chain, accuracy, sessions, jobs, logger);
  return { service, db, jobs, sessions, accuracy, chainReads: () => chainReads };
}

test('recordOutcome seeds at 7000 (never from the on-chain score) and applies the EMA', () => {
  const { service, chainReads } = makeService();
  assert.equal(service.recordOutcome(NODE, 'pass'), 7015); // 7000 → one PASS_ALPHA step
  assert.equal(service.recordOutcome(NODE, 'fail'), 6664); // 7015·0.95
  assert.equal(chainReads(), 0, 'accuracy state must not touch the chain');
});

test('dimensionsFor combines telemetry + chain reads into the composite', async () => {
  const now = Date.now();
  const { service, jobs, sessions } = makeService({
    registeredAt: BigInt(Math.floor((now - 365 * DAY_MS) / 1000)), // longevity 1.0
    stakeAmount: 2_500n * QAIS, // stake 0.25
  });
  sessions.open(NODE, now - 1000); // just connected → uptime 1.0
  // One settled job with a 1200ms TTFT → latency dim 0.75.
  jobs.recordAssigned({
    jobId: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
    requester: NODE,
    provider: NODE,
    model: 'mock-model',
    maxTokens: 10,
    agreedPriceWei: 1n,
    lockedWei: 10n,
  });
  jobs.recordFirstToken(('0x' + 'aa'.repeat(32)) as `0x${string}`, 1200);

  const d = await service.dimensionsFor(NODE);
  assert.equal(d.accuracyBps, INITIAL_ACCURACY_BPS, 'unseen node starts at the 0.70 seed');
  assert.equal(d.uptimeBps, 10000);
  assert.equal(d.latencyBps, 7500);
  assert.equal(d.longevityBps, 10000);
  assert.equal(d.stakeBps, 2500);
  // 0.40·7000 + 0.25·10000 + 0.15·7500 + 0.10·10000 + 0.10·2500 = 7675
  assert.equal(d.compositeBps, 7675);
});

test('dimensionsFor skips the chain read when the node struct is supplied', async () => {
  const { service, chainReads } = makeService();
  await service.dimensionsFor(NODE, { registeredAt: 0n, stakeAmount: 0n });
  assert.equal(chainReads(), 0);
  await service.dimensionsFor(NODE);
  assert.equal(chainReads(), 1);
});
