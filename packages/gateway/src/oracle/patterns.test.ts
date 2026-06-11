import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import pino from 'pino';
import { GatewayDb } from '../db/index.js';
import { JobStore } from '../db/jobs.js';
import { NodeFlagStore } from '../db/node-flags.js';
import {
  detectDuplicateOutputs,
  detectTruncationPattern,
  PatternDetector,
  type PatternRow,
} from './patterns.js';

const logger = pino({ level: 'silent' });
const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const REQ = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

function rows(spec: Array<[hash: string | null, finish: string | null]>): PatternRow[] {
  return spec.map(([resultHash, finishReason]) => ({ resultHash, finishReason }));
}

test('detectDuplicateOutputs: threshold boundary at 3 distinct jobs per hash', () => {
  assert.deepEqual(
    detectDuplicateOutputs(
      rows([
        ['a', 's'],
        ['a', 's'],
      ]),
    ),
    [],
    '2 repeats: clean',
  );
  assert.deepEqual(
    detectDuplicateOutputs(
      rows([
        ['a', 's'],
        ['a', 's'],
        ['a', 's'],
      ]),
    ),
    ['a'],
    '3 repeats flags',
  );
  assert.deepEqual(
    detectDuplicateOutputs(
      rows([
        ['a', 's'],
        ['b', 's'],
        ['c', 's'],
        [null, 's'],
      ]),
    ),
    [],
    'unique hashes + missing hashes: clean',
  );
});

test('detectTruncationPattern: needs history AND a (near-)total length ratio', () => {
  const allTruncated = (n: number) => rows(Array.from({ length: n }, () => ['h', 'length']));
  assert.equal(detectTruncationPattern(allTruncated(9)), false, 'below the 10-job minimum');
  assert.equal(detectTruncationPattern(allTruncated(10)), true, 'all-length at the minimum');
  // 1 honest stop in 20 → ratio 0.95 → still flags; 2 in 20 → 0.90 → clean.
  assert.equal(
    detectTruncationPattern(
      rows([
        ...Array.from({ length: 19 }, () => ['h', 'length'] as [string, string]),
        ['h', 'stop'],
      ]),
    ),
    true,
  );
  assert.equal(
    detectTruncationPattern(
      rows([
        ...Array.from({ length: 18 }, () => ['h', 'length'] as [string, string]),
        ['h', 'stop'],
        ['h', 'stop'],
      ]),
    ),
    false,
  );
});

test('PatternDetector.scanAll flags a duplicate-output cheater once per ongoing window', () => {
  const db = new GatewayDb();
  const jobs = new JobStore(db);
  const flags = new NodeFlagStore(db);
  const cannedHash = ('0x' + 'cc'.repeat(32)) as Hex;
  for (let i = 0; i < 3; i++) {
    const jobId = ('0x' + i.toString(16).padStart(2, '0').repeat(32)) as Hex;
    jobs.recordAssigned({
      jobId,
      requester: REQ,
      provider: NODE,
      model: 'mock-model',
      maxTokens: 50,
      agreedPriceWei: 1n,
      lockedWei: 50n,
    });
    jobs.markSettled(jobId, {
      actualTokens: 10,
      paymentWei: 10n,
      providerPayWei: 9n,
      feeWei: 1n,
      resultHash: cannedHash, // identical output for three DIFFERENT prompts
      finishReason: 'stop',
    });
  }

  const detector = new PatternDetector(db, flags, logger);
  detector.scanAll();
  assert.equal(flags.countFor(NODE), 1, 'caching cheater flagged');
  assert.equal(flags.forWallet(NODE)[0]?.kind, 'pattern:duplicate-output');

  detector.scanAll();
  assert.equal(flags.countFor(NODE), 1, 're-scan does not duplicate the open flag');
});
