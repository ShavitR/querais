import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import { GatewayDb } from './index.js';
import { NodeSessionStore } from './node-sessions.js';
import { NodeReputationStore } from './node-reputation.js';

const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const OTHER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

test('open/close records a session interval; touch advances last_seen', () => {
  const store = new NodeSessionStore(new GatewayDb());
  store.open(NODE, 1000);
  assert.deepEqual(store.intervalsSince(NODE, 0), [{ start: 1000, end: null }]);
  assert.equal(store.lastActive(NODE), 1000);

  store.touch(NODE, 5000);
  assert.equal(store.lastActive(NODE), 5000);

  store.close(NODE, 9000);
  assert.deepEqual(store.intervalsSince(NODE, 0), [{ start: 1000, end: 9000 }]);
  assert.equal(store.lastActive(NODE), 9000);

  // touch after close is a no-op (no open session).
  store.touch(NODE, 12_000);
  assert.equal(store.lastActive(NODE), 9000);
});

test('intervalsSince filters sessions that ended before the window', () => {
  const store = new NodeSessionStore(new GatewayDb());
  store.open(NODE, 1000);
  store.close(NODE, 2000);
  store.open(NODE, 3000);
  store.close(NODE, 4000);
  store.open(NODE, 5000); // still open
  store.open(OTHER, 100); // other wallets never bleed in

  assert.deepEqual(store.intervalsSince(NODE, 2500), [
    { start: 3000, end: 4000 },
    { start: 5000, end: null },
  ]);
});

test('closeAllOpen (boot crash-recovery) closes dangling sessions at their last_seen', () => {
  const store = new NodeSessionStore(new GatewayDb());
  store.open(NODE, 1000);
  store.touch(NODE, 7000); // last pong before the "crash"
  store.open(OTHER, 2000);

  store.closeAllOpen();
  assert.deepEqual(store.intervalsSince(NODE, 0), [{ start: 1000, end: 7000 }]);
  assert.deepEqual(store.intervalsSince(OTHER, 0), [{ start: 2000, end: 2000 }]);
});

test('NodeReputationStore: get/set round-trips and upserts', () => {
  const store = new NodeReputationStore(new GatewayDb());
  assert.equal(store.get(NODE), undefined, 'unseen node has no accuracy state');
  store.set(NODE, 7015);
  assert.equal(store.get(NODE)?.accuracyBps, 7015);
  store.set(NODE, 6664);
  assert.equal(store.get(NODE)?.accuracyBps, 6664);
  assert.equal(store.get(OTHER), undefined);
});
