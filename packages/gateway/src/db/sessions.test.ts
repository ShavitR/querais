import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { SessionStore, type CreditSession } from './sessions.js';

const REQUESTER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const SETTLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const SIG = ('0x' + 'cd'.repeat(65)) as Hex;

function session(over: Partial<CreditSession> = {}): CreditSession {
  return {
    requester: REQUESTER,
    settler: SETTLER,
    maxSpendWei: 1_000n,
    nonce: 1n,
    deadline: 2_000_000_000n,
    signature: SIG,
    ...over,
  };
}

test('stores and returns an active session; expired or missing returns undefined', () => {
  const store = new SessionStore(new GatewayDb());
  store.upsert(session({ deadline: 2_000_000_000n }));

  const active = store.getActive(REQUESTER, 1_900_000_000);
  assert.equal(active?.maxSpendWei, 1_000n);
  assert.equal(active?.nonce, 1n);
  assert.equal(active?.settler, SETTLER.toLowerCase());

  // Past the deadline → not active.
  assert.equal(store.getActive(REQUESTER, 2_000_000_001), undefined);
  // Unknown requester → none.
  assert.equal(store.getActive(SETTLER, 1_900_000_000), undefined);
});

test('a new cap replaces the requester’s previous one (one active session)', () => {
  const store = new SessionStore(new GatewayDb());
  store.upsert(session({ nonce: 1n, maxSpendWei: 1_000n }));
  store.upsert(session({ nonce: 2n, maxSpendWei: 5_000n }));
  const active = store.getActive(REQUESTER, 1_900_000_000);
  assert.equal(active?.nonce, 2n);
  assert.equal(active?.maxSpendWei, 5_000n);
});
