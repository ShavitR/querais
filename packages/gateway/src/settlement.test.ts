import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import type { Address, Hex } from 'viem';
import { ChainSettlement, SLASH_BPS } from './settlement.js';
import type { ChainClient } from './chain-client.js';

// The accuracy-EMA tests moved to reputation.test.ts with the function (Slice 4A).

const logger = pino({ level: 'silent' });
const PROVIDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const JOB = ('0x' + '11'.repeat(32)) as Hex;
const TX = ('0x' + 'ab'.repeat(32)) as Hex;

test('SLASH_BPS stays a small per-incident penalty (1%)', () => {
  assert.equal(SLASH_BPS, 100n);
  assert.equal((10_000n * SLASH_BPS) / 10000n, 100n);
});

/** Spy chain: counts every method settlement may touch. */
function fakeChain() {
  const calls: string[] = [];
  const chain = {
    completeJob: async () => (calls.push('completeJob'), TX),
    verifyAndRelease: async () => (calls.push('verifyAndRelease'), TX),
    failJob: async () => (calls.push('failJob'), TX),
    slash: async () => (calls.push('slash'), TX),
    updateReputation: async () => (calls.push('updateReputation'), TX),
    getJob: async () => ({ provider: PROVIDER }),
    getNode: async () => ({ reputationScore: 7000n, stakeAmount: 1_000n, exists: true }),
  } as unknown as ChainClient;
  return { chain, calls };
}

test('ChainSettlement.settle moves money only — no per-pass reputation write (4B)', async () => {
  const { chain, calls } = fakeChain();
  await new ChainSettlement(chain, logger).settle({
    jobId: JOB,
    provider: PROVIDER,
    requester: PROVIDER,
    authoritativeTokens: 10,
    resultHash: JOB,
  });
  assert.deepEqual(calls, ['completeJob', 'verifyAndRelease']);
});

test('ChainSettlement.fail refunds + slashes — the reputation hit is the dispatcher’s (4B)', async () => {
  const { chain, calls } = fakeChain();
  await new ChainSettlement(chain, logger).fail(JOB, 'garbage output');
  assert.deepEqual(calls, ['failJob', 'slash']);
  assert.ok(!calls.includes('updateReputation'), 'no per-event reputation chain write');
});
