import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_VERSION } from './index.js';

test('shared package smoke test', () => {
  assert.equal(typeof SHARED_VERSION, 'string');
});
