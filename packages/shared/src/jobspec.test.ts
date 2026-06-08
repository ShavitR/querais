import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringify } from './ids.js';
import { computeJobId, identify, jobSpecSchema, type JobSpec } from './jobspec.js';

const rawSpec = {
  model: 'meta-llama/Llama-3-8B-Instruct',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello\r\nworld' },
  ],
  maxTokens: 256,
  temperature: 0.7,
  stream: true,
  requesterWallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  maxPricePerTokenWei: '1000000000000000',
  minReputation: 8500,
  createdAt: 1_717_000_000,
  deadline: 1_717_000_030,
};

test('canonicalStringify is independent of key insertion order', () => {
  assert.equal(canonicalStringify({ a: 1, b: 2 }), canonicalStringify({ b: 2, a: 1 }));
  assert.equal(
    canonicalStringify({ x: { p: 1, q: 2 }, y: [3, 2, 1] }),
    canonicalStringify({ y: [3, 2, 1], x: { q: 2, p: 1 } }),
  );
});

test('jobSpecSchema parses and lowercases the requester wallet', () => {
  const spec = jobSpecSchema.parse(rawSpec);
  assert.equal(spec.requesterWallet, '0x90f79bf6eb2c4f870365e785982e1f101e93b906');
});

test('jobSpecSchema rejects an invalid address', () => {
  assert.throws(() => jobSpecSchema.parse({ ...rawSpec, requesterWallet: '0xnothex' }));
});

test('computeJobId is deterministic and a 32-byte hex', () => {
  const spec = jobSpecSchema.parse(rawSpec);
  const id1 = computeJobId(spec);
  const id2 = computeJobId(spec);
  assert.equal(id1, id2);
  assert.match(id1, /^0x[0-9a-f]{64}$/);
});

test('jobId is stable regardless of object field order', () => {
  const spec = jobSpecSchema.parse(rawSpec);
  // Re-create the same logical spec with a different property insertion order.
  const reordered: JobSpec = {
    deadline: spec.deadline,
    messages: spec.messages,
    model: spec.model,
    createdAt: spec.createdAt,
    minReputation: spec.minReputation,
    requesterWallet: spec.requesterWallet,
    stream: spec.stream,
    temperature: spec.temperature,
    maxTokens: spec.maxTokens,
    maxPricePerTokenWei: spec.maxPricePerTokenWei,
  };
  assert.equal(computeJobId(reordered), computeJobId(spec));
});

test('any meaningful change yields a different jobId', () => {
  const spec = jobSpecSchema.parse(rawSpec);
  const base = computeJobId(spec);
  assert.notEqual(computeJobId({ ...spec, maxTokens: 257 }), base);
  assert.notEqual(computeJobId({ ...spec, deadline: spec.deadline + 1 }), base);
  assert.notEqual(
    computeJobId({ ...spec, messages: [...spec.messages, { role: 'user', content: 'x' }] }),
    base,
  );
});

test('identify attaches a matching jobId', () => {
  const spec = jobSpecSchema.parse(rawSpec);
  const identified = identify(spec);
  assert.equal(identified.jobId, computeJobId(spec));
});
