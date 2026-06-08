import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emaReputationBps } from './settlement.js';

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
