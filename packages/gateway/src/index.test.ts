import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY_VERSION } from './index.js';

test('gateway package smoke test', () => {
  assert.equal(typeof GATEWAY_VERSION, 'string');
});
