import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_VERSION } from '@querais/shared';

test('test-e2e harness smoke test', () => {
  // The real end-to-end acceptance test (full slice + on-chain settlement)
  // lands in M6. For now we only assert the workspace wiring resolves.
  assert.equal(typeof SHARED_VERSION, 'string');
});
