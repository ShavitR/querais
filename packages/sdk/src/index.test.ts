import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SDK_VERSION } from './index.js';

test('sdk package smoke test', () => {
  assert.equal(typeof SDK_VERSION, 'string');
});
