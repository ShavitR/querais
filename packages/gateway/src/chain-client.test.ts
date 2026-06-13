import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hex } from 'viem';
import { ChainClient, isNonceError } from './chain-client.js';

// `submitWrite` is private; the chain clients/deployment it stores are never touched
// by it (it only invokes the thunk we pass), so dummies are safe for these tests.
function chainClient(): {
  submitWrite(send: () => Promise<Hex>): Promise<Hex>;
} {
  return new ChainClient({} as never, {} as never, {} as never) as unknown as {
    submitWrite(send: () => Promise<Hex>): Promise<Hex>;
  };
}

const HASH = ('0x' + '11'.repeat(32)) as Hex;

test('isNonceError matches the stale-nonce phrasings RPCs use', () => {
  assert.equal(isNonceError(new Error('nonce too low: address 0xabc tx 5 state 6')), true);
  assert.equal(isNonceError(new Error('Nonce has already been used')), true);
  assert.equal(isNonceError(new Error('invalid nonce')), true);
  assert.equal(isNonceError(new Error('Nonce provided 5 is lower than expected 6')), true);
  assert.equal(isNonceError(new Error("the tx doesn't have the correct nonce")), true);
});

test('isNonceError walks the cause chain + viem BaseError fields', () => {
  // viem wraps the RPC error: the "nonce too low" text often lives in `details`/`cause`,
  // not the top-level message.
  const root = new Error('JSON-RPC error') as Error & { details?: string };
  root.details = 'nonce too low: tx 7 state 8';
  const wrapped = new Error('TransactionExecutionError: failed to send tx') as Error & {
    cause?: unknown;
  };
  wrapped.cause = root;
  assert.equal(isNonceError(wrapped), true);
});

test('isNonceError ignores non-nonce failures (must not be retried)', () => {
  assert.equal(isNonceError(new Error('execution reverted: cap expired')), false);
  assert.equal(isNonceError(new Error('fetch failed')), false);
  assert.equal(isNonceError(new Error('insufficient funds for gas')), false);
  assert.equal(isNonceError(undefined), false);
  assert.equal(isNonceError(null), false);
});

test('submitWrite retries once on a nonce error, then succeeds', async () => {
  const client = chainClient();
  let calls = 0;
  const result = await client.submitWrite(async () => {
    calls += 1;
    if (calls === 1) throw new Error('nonce too low: tx 5 state 6');
    return HASH;
  });
  assert.equal(calls, 2);
  assert.equal(result, HASH);
});

test('submitWrite does NOT retry a non-nonce error (e.g. a revert)', async () => {
  const client = chainClient();
  let calls = 0;
  await assert.rejects(
    client.submitWrite(async () => {
      calls += 1;
      throw new Error('execution reverted: cap expired');
    }),
    /execution reverted/,
  );
  assert.equal(calls, 1);
});

test('submitWrite gives up after one retry and re-throws the nonce error', async () => {
  const client = chainClient();
  let calls = 0;
  await assert.rejects(
    client.submitWrite(async () => {
      calls += 1;
      throw new Error('nonce too low');
    }),
    /nonce too low/,
  );
  assert.equal(calls, 2);
});
