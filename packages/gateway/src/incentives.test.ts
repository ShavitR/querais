import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import { parseEther } from 'viem';
import pino from 'pino';
import { GatewayDb } from './db/index.js';
import { JobStore } from './db/jobs.js';
import { NodeSessionStore } from './db/node-sessions.js';
import type { ChainClient } from './chain-client.js';
import {
  bootstrapPurpose,
  firstModelPurpose,
  IncentiveService,
  resolveIncentives,
  splitUptimePool,
  tenureMultiplierBps,
} from './incentives.js';

const logger = pino({ level: 'silent' });
const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const OTHER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const DAY_MS = 86_400_000;

// ── pure boundaries ───────────────────────────────────────────────────────────────

test('tenureMultiplierBps follows the spec table at exact boundaries', () => {
  assert.equal(tenureMultiplierBps(0), 10000);
  assert.equal(tenureMultiplierBps(29), 10000);
  assert.equal(tenureMultiplierBps(30), 10500);
  assert.equal(tenureMultiplierBps(59), 10500);
  assert.equal(tenureMultiplierBps(60), 11500);
  assert.equal(tenureMultiplierBps(89), 11500);
  assert.equal(tenureMultiplierBps(90), 12500);
  assert.equal(tenureMultiplierBps(400), 12500);
});

test('splitUptimePool: equal shares, zero qualifiers, dust stays unallocated', () => {
  assert.equal(splitUptimePool(parseEther('100'), 4), parseEther('25'));
  assert.equal(splitUptimePool(parseEther('100'), 0), 0n);
  assert.equal(splitUptimePool(100n, 3), 33n); // 1 wei dust never leaves the treasury
});

test('firstProviderByModel attributes each model to its earliest verified provider', () => {
  const jobs = new JobStore(new GatewayDb());
  const j = (n: number): Hex => ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex;
  const assign = (id: Hex, model: string, provider: Address) => {
    jobs.recordAssigned({
      jobId: id,
      requester: OTHER,
      provider,
      model,
      maxTokens: 10,
      agreedPriceWei: 1n,
      lockedWei: 10n,
    });
    jobs.markSettled(id, { actualTokens: 5, paymentWei: 5n, providerPayWei: 4n, feeWei: 1n });
  };
  assign(j(1), 'model-a', NODE); // first for model-a
  assign(j(2), 'model-a', OTHER); // later — not attributed
  assign(j(3), 'model-b', OTHER); // first for model-b
  // A failed job never counts.
  jobs.recordAssigned({
    jobId: j(4),
    requester: OTHER,
    provider: NODE,
    model: 'model-c',
    maxTokens: 10,
    agreedPriceWei: 1n,
    lockedWei: 10n,
  });
  jobs.markFailed(j(4), 'bad output');

  const first = jobs.firstProviderByModel();
  assert.equal(first.get('model-a'), NODE.toLowerCase());
  assert.equal(first.get('model-b'), OTHER.toLowerCase());
  assert.equal(first.has('model-c'), false, 'failed jobs earn no attribution');
});

// ── the recommendation engine ─────────────────────────────────────────────────────

function fixture(opts: {
  nodes: Array<{ wallet: Address; tenureDays: number; uptimeFraction: number }>;
  paidPurposes?: string[];
  firstModels?: Array<[model: string, provider: Address]>;
  config?: Parameters<typeof resolveIncentives>[0];
}) {
  const db = new GatewayDb();
  const jobs = new JobStore(db);
  const sessions = new NodeSessionStore(db);
  const nowMs = Date.now();
  const windowMs = 30 * DAY_MS;

  for (const n of opts.nodes) {
    // Uptime: one interval covering `uptimeFraction` of the trailing window, ending now
    // (so first-seen ≈ window start keeps the denominator the full window).
    const start = nowMs - windowMs;
    sessions.open(n.wallet, start);
    sessions.close(n.wallet, start + Math.floor(windowMs * n.uptimeFraction));
  }
  let i = 0;
  for (const [model, provider] of opts.firstModels ?? []) {
    const id = ('0x' + (++i).toString(16).padStart(2, '0').repeat(32)) as Hex;
    jobs.recordAssigned({
      jobId: id,
      requester: OTHER,
      provider,
      model,
      maxTokens: 10,
      agreedPriceWei: 1n,
      lockedWei: 10n,
    });
    jobs.markSettled(id, { actualTokens: 5, paymentWei: 5n, providerPayWei: 4n, feeWei: 1n });
  }

  const chain = {
    activeNodeWallets: async () => opts.nodes.map((n) => n.wallet),
    getNode: async (wallet: Address) => {
      const n = opts.nodes.find((x) => x.wallet === wallet)!;
      return {
        registeredAt: BigInt(Math.floor((nowMs - n.tenureDays * DAY_MS) / 1000)),
        stakeAmount: parseEther('100'),
        exists: true,
      };
    },
    allocatedPurposes: async () => opts.paidPurposes ?? [],
    treasuryOpsRetained: async () => parseEther('10000'),
  } as unknown as ChainClient;

  return new IncentiveService(chain, sessions, jobs, resolveIncentives(opts.config), logger);
}

test('uptime pool: only qualifiers paid, equal split scaled by tenure multiplier', async () => {
  const service = fixture({
    nodes: [
      { wallet: NODE, tenureDays: 90, uptimeFraction: 0.99 }, // 1.25× veteran
      { wallet: OTHER, tenureDays: 5, uptimeFraction: 0.5 }, // below the 95% bar
    ],
    config: { uptimePoolQais: 100, bootstrapMinTenureDays: 365 }, // mute bootstrap here
  });
  const rec = await service.computeRecommendation();
  const uptime = rec.payouts.filter((p) => p.program === 'uptime-pool');
  assert.equal(uptime.length, 1, 'only the >=95% node qualifies');
  assert.equal(uptime[0]!.recipient, NODE);
  // Sole qualifier: 100-QAIS share × 1.25 tenure multiplier.
  assert.equal(BigInt(uptime[0]!.amountWei), parseEther('125'));
  const other = rec.nodes.find((n) => n.wallet === OTHER)!;
  assert.equal(other.uptimeEligible, false);
});

test('first-model bonus: attributed once and deduped by on-chain purpose', async () => {
  const make = (paid: string[]) =>
    fixture({
      nodes: [{ wallet: NODE, tenureDays: 1, uptimeFraction: 0.99 }],
      firstModels: [
        ['llama3', NODE],
        ['gemma', NODE],
      ],
      paidPurposes: paid,
      config: { firstModelBonusQais: 50, uptimePoolQais: 0, bootstrapMinTenureDays: 365 },
    });
  const fresh = await make([]).computeRecommendation();
  assert.equal(fresh.payouts.filter((p) => p.program === 'first-model').length, 2);

  const afterPay = await make([firstModelPurpose('llama3')]).computeRecommendation();
  const pending = afterPay.payouts.filter((p) => p.program === 'first-model');
  assert.equal(pending.length, 1, 'the paid bonus drops out of the recommendation');
  assert.equal(pending[0]!.purpose, firstModelPurpose('gemma'));
});

test('bootstrap bonus: earliest N actives with >=30d tenure, once per node', async () => {
  const service = fixture({
    nodes: [
      { wallet: NODE, tenureDays: 45, uptimeFraction: 0.99 }, // eligible
      { wallet: OTHER, tenureDays: 10, uptimeFraction: 0.99 }, // too young
    ],
    paidPurposes: [],
    config: { uptimePoolQais: 0, bootstrapBonusQais: 5000, bootstrapMaxNodes: 100 },
  });
  const rec = await service.computeRecommendation();
  const boots = rec.payouts.filter((p) => p.program === 'bootstrap');
  assert.equal(boots.length, 1);
  assert.equal(boots[0]!.recipient, NODE);
  assert.equal(BigInt(boots[0]!.amountWei), parseEther('5000'));
  assert.equal(boots[0]!.purpose, bootstrapPurpose(NODE));

  const paid = fixture({
    nodes: [{ wallet: NODE, tenureDays: 45, uptimeFraction: 0.99 }],
    paidPurposes: [bootstrapPurpose(NODE)],
    config: { uptimePoolQais: 0 },
  });
  const rec2 = await paid.computeRecommendation();
  assert.equal(
    rec2.payouts.filter((p) => p.program === 'bootstrap').length,
    0,
    'the launch bonus is one-time',
  );
});

test('funds sufficiency compares the total against the treasury ops share', async () => {
  const service = fixture({
    nodes: [{ wallet: NODE, tenureDays: 45, uptimeFraction: 0.99 }],
    config: { uptimePoolQais: 100, bootstrapBonusQais: 100000 }, // beyond the 10k ops stub
  });
  const rec = await service.computeRecommendation();
  assert.equal(rec.fundsSufficient, false, 'recommendation flags an underfunded epoch');
  assert.ok(BigInt(rec.totalRecommendedWei) > BigInt(rec.opsSpendableWei));
});
