import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_DAEMON_VERSION } from './index.js';

test('node-daemon package smoke test', () => {
  assert.equal(typeof NODE_DAEMON_VERSION, 'string');
});
