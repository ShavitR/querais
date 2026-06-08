// TEMPORARY — verifies CI goes red on a failing test. Deleted after the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deliberate failure to prove the CI gate blocks', () => {
  assert.equal(1, 2);
});
