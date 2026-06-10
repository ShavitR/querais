import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLASH_BPS } from './settlement.js';

// The accuracy-EMA tests moved to reputation.test.ts with the function (Slice 4).

test('SLASH_BPS stays a small per-incident penalty (1%)', () => {
  assert.equal(SLASH_BPS, 100n);
  assert.equal((10_000n * SLASH_BPS) / 10000n, 100n);
});
