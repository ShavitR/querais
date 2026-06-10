import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { JobStore, type AssignedJob } from './jobs.js';

const REQUESTER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const PROVIDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;

function assigned(jobId: Hex, over: Partial<AssignedJob> = {}): AssignedJob {
  return {
    jobId,
    requester: REQUESTER,
    provider: PROVIDER,
    model: 'mock-model',
    maxTokens: 100,
    agreedPriceWei: 1000n,
    lockedWei: 100_000n,
    ...over,
  };
}

const JOB_A = ('0x' + '11'.repeat(32)) as Hex;
const JOB_B = ('0x' + '22'.repeat(32)) as Hex;
const JOB_C = ('0x' + '33'.repeat(32)) as Hex;

test('records assignment, settlement, and aggregates usage from settled jobs only', () => {
  const jobs = new JobStore(new GatewayDb());

  jobs.recordAssigned(assigned(JOB_A));
  jobs.recordAssigned(assigned(JOB_B));
  jobs.recordAssigned(assigned(JOB_C));

  // A settles for 40 tokens @ 1000 wei = 40000 wei (95/5 split).
  jobs.markSettled(JOB_A, {
    actualTokens: 40,
    paymentWei: 40_000n,
    providerPayWei: 38_000n,
    feeWei: 2_000n,
  });
  // B settles for 10 tokens = 10000 wei.
  jobs.markSettled(JOB_B, {
    actualTokens: 10,
    paymentWei: 10_000n,
    providerPayWei: 9_500n,
    feeWei: 500n,
  });
  // C fails — must NOT count toward usage.
  jobs.markFailed(JOB_C, 'degenerate repetition detected');

  const a = jobs.get(JOB_A);
  assert.equal(a?.status, 'verified');
  assert.equal(a?.actualTokens, 40);
  assert.equal(a?.providerPayWei, '38000');
  assert.equal(a?.feeWei, '2000');
  assert.equal(a?.requester, REQUESTER.toLowerCase());

  const c = jobs.get(JOB_C);
  assert.equal(c?.status, 'failed');
  assert.equal(c?.reason, 'degenerate repetition detected');

  // Usage: 2 settled jobs, 50 tokens, 50000 wei spent (C excluded).
  const usage = jobs.usageFor(REQUESTER);
  assert.deepEqual(usage, { jobs: 2, tokens: 50, spentWei: '50000' });

  // A different requester has no usage.
  assert.deepEqual(jobs.usageFor(PROVIDER), { jobs: 0, tokens: 0, spentWei: '0' });
});

test('TTFT telemetry: recordFirstToken stamps the row; firstTokenMsSince filters by provider/window', () => {
  const jobs = new JobStore(new GatewayDb());
  jobs.recordAssigned(assigned(JOB_A));
  jobs.recordAssigned(assigned(JOB_B));
  jobs.recordAssigned(assigned(JOB_C, { provider: REQUESTER })); // different provider

  jobs.recordFirstToken(JOB_A, 320.7); // rounded to integer ms
  jobs.recordFirstToken(JOB_B, 1200);
  jobs.recordFirstToken(JOB_C, 50);

  const samples = jobs.firstTokenMsSince(PROVIDER, 0).sort((a, b) => a - b);
  assert.deepEqual(samples, [321, 1200], 'only this provider, only stamped rows');
  assert.deepEqual(jobs.firstTokenMsSince(PROVIDER, Date.now() + 1000), [], 'window filters');
});

test('job records survive a restart', () => {
  const path = join(tmpdir(), `querais-jobs-${process.pid}-${Date.now()}.db`);
  try {
    const first = new GatewayDb(path);
    const a = new JobStore(first);
    a.recordAssigned(assigned(JOB_A));
    a.markSettled(JOB_A, {
      actualTokens: 5,
      paymentWei: 5_000n,
      providerPayWei: 4_750n,
      feeWei: 250n,
    });
    first.close();

    const second = new GatewayDb(path);
    const usage = new JobStore(second).usageFor(REQUESTER);
    assert.deepEqual(usage, { jobs: 1, tokens: 5, spentWei: '5000' });
    second.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }
});
