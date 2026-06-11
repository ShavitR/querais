import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeeperHealth } from './keeper-health.js';

test('a keeper is stale only after 2x its interval without a beat', () => {
  const kh = new KeeperHealth();
  const t0 = 1_000_000;
  kh.register('flush', 60_000, t0);
  kh.register('snapshot', 86_400_000, t0);

  assert.deepEqual(kh.stale(t0), [], 'fresh registration: nothing stale');
  assert.deepEqual(kh.stale(t0 + 120_000), [], 'exactly 2x interval is still in grace');
  assert.equal(kh.stale(t0 + 120_001).length, 1, 'past 2x interval: stale');
  assert.equal(kh.stale(t0 + 120_001)[0]!.name, 'flush');

  kh.beat('flush', t0 + 120_000);
  assert.deepEqual(kh.stale(t0 + 200_000), [], 'a beat resets the clock');
  // The daily keeper has its own (much longer) leash.
  assert.equal(kh.stale(t0 + 2 * 86_400_000 + 1).length, 2);
});

test('beat on an unregistered name is a no-op; list reports every keeper', () => {
  const kh = new KeeperHealth();
  kh.register('treasury', 3_600_000, 5);
  kh.beat('nonexistent', 99); // must not throw inside a keeper tick
  assert.equal(kh.list().length, 1);
  assert.deepEqual(kh.list()[0], { name: 'treasury', intervalMs: 3_600_000, lastSuccessAt: 5 });
});
