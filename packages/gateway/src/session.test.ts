import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import { SessionAuth } from './session.js';

const WALLET = '0xc80a8137e57d494b195eda12f74d7df324f5b9d6' as Address;

test('mint → verify round-trips wallet + tier', () => {
  const s = new SessionAuth('secret', 3600);
  const claims = s.verify(s.mint(WALLET, 'pro'));
  assert.ok(claims);
  assert.equal(claims.wallet, WALLET);
  assert.equal(claims.tier, 'pro');
});

test('a tampered payload or signature fails verification', () => {
  const s = new SessionAuth('secret', 3600);
  const token = s.mint(WALLET, 'free');
  const [payload, sig] = token.split('.');
  assert.equal(s.verify(`${payload}x.${sig}`), null, 'mutated payload rejected');
  assert.equal(s.verify(`${payload}.${'0'.repeat(sig!.length)}`), null, 'forged sig rejected');
  assert.equal(s.verify('not-a-token'), null, 'malformed rejected');
  assert.equal(s.verify(undefined), null, 'absent rejected');
});

test('a different secret cannot verify the cookie (per-gateway keying)', () => {
  const minted = new SessionAuth('secret-A', 3600).mint(WALLET, 'free');
  assert.equal(new SessionAuth('secret-B', 3600).verify(minted), null);
});

test('an expired cookie is rejected', () => {
  const s = new SessionAuth('secret', 3600);
  const token = s.mint(WALLET, 'free', 1_000); // exp = 1000 + 3600 = 4600
  assert.ok(s.verify(token, 4_000), 'valid before expiry');
  assert.equal(s.verify(token, 5_000), null, 'rejected after expiry');
});
