import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { AlertService, MemorySink } from './alerts.js';
import { AlertSweeper, type SweepReads, type SweepThresholds } from './alert-rules.js';
import { KeeperHealth } from './keeper-health.js';

const logger = pino({ level: 'silent' });

const THRESHOLDS: SweepThresholds = {
  gasMinWei: 10n ** 16n, // 0.01 ETH
  debitMaxAgeSeconds: 900,
  settleFailStreak: 3,
};

/** A healthy system: every rule quiet. Override per test. */
function healthyReads(over: Partial<SweepReads> = {}): SweepReads {
  return {
    gasBalanceWei: async () => 10n ** 18n, // 1 ETH
    oldestPendingDebitAt: () => undefined,
    consecutiveFlushFailures: () => 0,
    connectedNodes: () => 3,
    openFlagCount: () => 0,
    faucet: undefined,
    staleKeepers: () => [],
    rpcProbe: async () => undefined,
    ...over,
  };
}

function fixture(
  reads: Partial<SweepReads> = {},
  cooldownSeconds = 0,
): { sweeper: AlertSweeper; sink: MemorySink } {
  const sink = new MemorySink();
  const alerts = new AlertService(sink, logger, { cooldownSeconds, minSeverity: 'info' });
  return { sweeper: new AlertSweeper(alerts, healthyReads(reads), THRESHOLDS), sink };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('a healthy system sweeps silently', async () => {
  const { sweeper, sink } = fixture();
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 0);
});

test('gas-low fires below the floor and respects cooldown across sweeps', async () => {
  const { sweeper, sink } = fixture({ gasBalanceWei: async () => 10n ** 15n }, 3600);
  await sweeper.sweep();
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 1, 'exactly one page, then cooldown');
  assert.equal(sink.alerts[0]!.rule, 'gas-low');
  assert.equal(sink.alerts[0]!.severity, 'critical');
});

test('stuck-debits: old pending debit pages; a fresh one does not', async () => {
  const now = Date.now();
  const fresh = fixture({ oldestPendingDebitAt: () => now - 5_000 });
  await fresh.sweeper.sweep(now);
  await settle();
  assert.equal(fresh.sink.alerts.length, 0, '5s-old debit is normal batching, not stuck');

  const stuck = fixture({ oldestPendingDebitAt: () => now - 901_000 });
  await stuck.sweeper.sweep(now);
  await settle();
  assert.equal(stuck.sink.alerts.length, 1);
  assert.equal(stuck.sink.alerts[0]!.rule, 'stuck-debits');
  assert.equal(stuck.sink.alerts[0]!.severity, 'critical');
});

test('settlement-failures pages at the streak threshold, not before', async () => {
  let streak = 2;
  const { sweeper, sink } = fixture({ consecutiveFlushFailures: () => streak });
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 0, 'streak of 2 < threshold 3');
  streak = 3;
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 1);
  assert.equal(sink.alerts[0]!.rule, 'settlement-failures');
});

test('node-drop: >=50% fall from the hourly high-water mark (max >= 2)', async () => {
  let connected = 4;
  const t0 = Date.now();
  const { sweeper, sink } = fixture({ connectedNodes: () => connected });
  await sweeper.sweep(t0); // high-water mark = 4
  connected = 3;
  await sweeper.sweep(t0 + 1_000); // 3 of 4 is fine
  await settle();
  assert.equal(sink.alerts.length, 0);

  connected = 2;
  await sweeper.sweep(t0 + 2_000); // 2 of 4: half gone
  await settle();
  assert.equal(sink.alerts.length, 1);
  assert.equal(sink.alerts[0]!.rule, 'node-drop');
  assert.equal(sink.alerts[0]!.severity, 'warn');
});

test('node-drop: hourly decay forgets the old high; 1->0 never pages (max < 2)', async () => {
  let connected = 4;
  const t0 = Date.now();
  const { sweeper, sink } = fixture({ connectedNodes: () => connected });
  await sweeper.sweep(t0);
  connected = 2;
  await sweeper.sweep(t0 + 3_700_000); // decayed: high-water resets to current (2)
  await settle();
  assert.equal(sink.alerts.length, 0, 'an hour-old peak no longer counts');

  const single = fixture({ connectedNodes: () => 1 });
  await single.sweeper.sweep(t0);
  const none = fixture({ connectedNodes: () => 0 });
  await none.sweeper.sweep(t0);
  await settle();
  assert.equal(single.sink.alerts.length, 0);
  assert.equal(none.sink.alerts.length, 0, 'a 0/1-node devnet never pages node-drop');
});

test('open-flags pages while the review queue is non-empty', async () => {
  const { sweeper, sink } = fixture({ openFlagCount: () => 2 });
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 1);
  assert.equal(sink.alerts[0]!.rule, 'open-flags');
  assert.match(sink.alerts[0]!.detail, /2 unreviewed/);
});

test('faucet-low: low QAIS or low ETH pages; zero claimEthWei ignores the ETH side', async () => {
  const claim = 10n ** 18n;
  const lowQais = fixture({
    faucet: {
      qaisBalance: async () => 9n * claim, // < 10 claims
      ethBalance: async () => 10n ** 18n,
      claimQaisWei: claim,
      claimEthWei: 10n ** 15n,
    },
  });
  await lowQais.sweeper.sweep();
  await settle();
  assert.equal(lowQais.sink.alerts.length, 1);
  assert.equal(lowQais.sink.alerts[0]!.rule, 'faucet-low');

  const ethDisabled = fixture({
    faucet: {
      qaisBalance: async () => 100n * claim,
      ethBalance: async () => 0n, // would be "low", but claims don't send ETH
      claimQaisWei: claim,
      claimEthWei: 0n,
    },
  });
  await ethDisabled.sweeper.sweep();
  await settle();
  assert.equal(ethDisabled.sink.alerts.length, 0, 'ETH side ignored when claimEthWei = 0');
});

test('keeper-stale: one alert key per stale keeper', async () => {
  const kh = new KeeperHealth();
  const t0 = 1_000_000;
  kh.register('flush', 10_000, t0);
  kh.register('snapshot', 10_000, t0);
  const { sweeper, sink } = fixture({ staleKeepers: (now) => kh.stale(now) });
  await sweeper.sweep(t0 + 30_000);
  await settle();
  assert.equal(sink.alerts.length, 2);
  assert.deepEqual(sink.alerts.map((a) => a.key).sort(), [
    'keeper-stale:flush',
    'keeper-stale:snapshot',
  ]);
  assert.ok(sink.alerts.every((a) => a.rule === 'keeper-stale'));
});

test('rpc-degraded: pages on the 3rd consecutive failure, resets on success', async () => {
  let up = false;
  let gasReads = 0;
  const { sweeper, sink } = fixture({
    rpcProbe: async () => {
      if (!up) throw new Error('ECONNREFUSED');
    },
    gasBalanceWei: async () => {
      gasReads += 1;
      return 10n ** 18n;
    },
  });
  await sweeper.sweep();
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 0, 'two failures: not yet degraded');
  assert.equal(gasReads, 0, 'balance rules skip their reads while RPC is down');

  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 1);
  assert.equal(sink.alerts[0]!.rule, 'rpc-degraded');
  assert.equal(sink.alerts[0]!.severity, 'critical');

  up = true;
  await sweeper.sweep(); // success resets the streak
  up = false;
  await sweeper.sweep();
  await sweeper.sweep();
  await settle();
  assert.equal(sink.alerts.length, 1, 'streak restarted: 2 new failures stay quiet');
});

test('a sweep never throws, even when every read explodes', async () => {
  const { sweeper, sink } = fixture({
    gasBalanceWei: async () => {
      throw new Error('boom');
    },
    faucet: {
      qaisBalance: async () => {
        throw new Error('boom');
      },
      ethBalance: async () => {
        throw new Error('boom');
      },
      claimQaisWei: 1n,
      claimEthWei: 1n,
    },
  });
  await sweeper.sweep(); // must resolve
  await settle();
  assert.equal(sink.alerts.length, 0);
});
