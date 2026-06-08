import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashText } from '@querais/shared';
import { buildCompletionReport } from './report.js';

test('buildCompletionReport commits to the output hash and token count', () => {
  const jobId = ('0x' + '11'.repeat(32)) as `0x${string}`;
  const report = buildCompletionReport(jobId, {
    content: 'hello world',
    promptTokens: 2,
    completionTokens: 2,
    finishReason: 'stop',
  });

  assert.equal(report.type, 'completion');
  assert.equal(report.jobId, jobId);
  assert.equal(report.tokenCount, 2);
  assert.equal(report.finishReason, 'stop');
  // resultHash pins the provider to the exact text it produced.
  assert.equal(report.resultHash, hashText('hello world'));
});
