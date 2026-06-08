import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelayMs } from './gateway-client.js';

test('backoffDelayMs doubles each attempt and caps at the max', () => {
  assert.equal(backoffDelayMs(0), 1000);
  assert.equal(backoffDelayMs(1), 2000);
  assert.equal(backoffDelayMs(2), 4000);
  assert.equal(backoffDelayMs(3), 8000);
  assert.equal(backoffDelayMs(10), 30_000); // capped
});
