import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashText, type CompletionReport } from '@querais/shared';
import { isDegenerateLoop, layerBVerify } from './verify.js';

const jobId = ('0x' + 'aa'.repeat(32)) as `0x${string}`;

function report(text: string, over: Partial<CompletionReport> = {}): CompletionReport {
  return {
    type: 'completion',
    jobId,
    tokenCount: 5,
    finishReason: 'stop',
    resultHash: hashText(text),
    ...over,
  };
}

test('passes a well-formed result and uses min(daemon, gateway) tokens', () => {
  const text = 'hello world this is fine';
  const v = layerBVerify({
    forwardedText: text,
    gatewayTokenCount: 6,
    report: report(text, { tokenCount: 5 }),
    maxTokens: 100,
  });
  assert.equal(v.ok, true);
  assert.equal(v.authoritativeTokens, 5);
});

test('fails empty output', () => {
  const v = layerBVerify({
    forwardedText: '   ',
    gatewayTokenCount: 0,
    report: report('   '),
    maxTokens: 100,
  });
  assert.equal(v.ok, false);
});

test('fails on result-hash mismatch (provider served different text)', () => {
  const v = layerBVerify({
    forwardedText: 'real output here',
    gatewayTokenCount: 3,
    report: report('a totally different output'),
    maxTokens: 100,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /hash mismatch/);
});

test('fails when the node reports more tokens than the max', () => {
  const text = 'a b c';
  const v = layerBVerify({
    forwardedText: text,
    gatewayTokenCount: 3,
    report: report(text, { tokenCount: 1000 }),
    maxTokens: 100,
  });
  assert.equal(v.ok, false);
});

test('fails when the node reports an error finish', () => {
  const text = 'partial';
  const v = layerBVerify({
    forwardedText: text,
    gatewayTokenCount: 1,
    report: report(text, { finishReason: 'error', tokenCount: 1 }),
    maxTokens: 100,
  });
  assert.equal(v.ok, false);
});

test('detects and rejects degenerate repetition loops', () => {
  const loop = Array(50).fill('na').join(' ');
  assert.equal(isDegenerateLoop(loop), true);
  const v = layerBVerify({
    forwardedText: loop,
    gatewayTokenCount: 50,
    report: report(loop, { tokenCount: 50 }),
    maxTokens: 100,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /repetition/);
});

test('does not flag normal varied text as a loop', () => {
  const text = 'the quick brown fox jumps over the lazy dog again today while birds sing softly';
  assert.equal(isDegenerateLoop(text), false);
});
