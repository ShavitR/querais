import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { ReputationSnapshotStore, type ReputationSnapshot } from './reputation-snapshots.js';

const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const OTHER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const TX = ('0x' + 'ab'.repeat(32)) as Hex;

function snap(over: Partial<ReputationSnapshot>): ReputationSnapshot {
  return {
    wallet: NODE,
    compositeBps: 7600,
    accuracyBps: 7000,
    uptimeBps: 10000,
    latencyBps: 10000,
    longevityBps: 0,
    stakeBps: 0,
    txHash: TX,
    flagged: false,
    createdAt: 1000,
    ...over,
  };
}

test('snapshot rows round-trip; latest returns the newest', () => {
  const store = new ReputationSnapshotStore(new GatewayDb());
  store.insert(snap({ compositeBps: 7600, createdAt: 1000 }));
  store.insert(snap({ compositeBps: 7200, createdAt: 2000, flagged: true }));

  const latest = store.latest(NODE);
  assert.equal(latest?.compositeBps, 7200);
  assert.equal(latest?.flagged, true);
  assert.equal(latest?.txHash, TX);
  assert.equal(store.latest(OTHER), undefined);
});

test('maxCompositeSince scopes the rapid-decline window per wallet', () => {
  const store = new ReputationSnapshotStore(new GatewayDb());
  store.insert(snap({ compositeBps: 9000, createdAt: 1000 })); // outside the window
  store.insert(snap({ compositeBps: 7600, createdAt: 5000 }));
  store.insert(snap({ compositeBps: 7000, createdAt: 6000 }));
  store.insert(snap({ wallet: OTHER, compositeBps: 9999, createdAt: 5500 }));

  assert.equal(store.maxCompositeSince(NODE, 4000), 7600, 'window max excludes older rows');
  assert.equal(store.maxCompositeSince(NODE, 0), 9000);
  assert.equal(store.maxCompositeSince(NODE, 7000), undefined, 'empty window');
});
