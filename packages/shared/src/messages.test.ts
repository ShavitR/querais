import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, jobSpecSchema } from './jobspec.js';
import { gatewayToNodeSchema, nodeToGatewaySchema, type CompletionReport } from './messages.js';

const wallet = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
const bytes32 = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

test('node→gateway: hello parses and round-trips through JSON', () => {
  const hello = {
    type: 'hello' as const,
    nodeId: 'QmNode',
    wallet,
    nonce: 'n-123',
    signature: '0xsig',
    models: [{ model: 'llama', pricePerTokenWei: '1000', tokensPerSecond: 42 }],
  };
  const parsed = nodeToGatewaySchema.parse(JSON.parse(JSON.stringify(hello)));
  assert.equal(parsed.type, 'hello');
});

test('node→gateway: token and completion parse', () => {
  assert.equal(
    nodeToGatewaySchema.parse({ type: 'token', jobId: bytes32, content: 'hi' }).type,
    'token',
  );
  const report: CompletionReport = {
    type: 'completion',
    jobId: bytes32,
    tokenCount: 128,
    finishReason: 'stop',
    resultHash: bytes32,
  };
  assert.equal(nodeToGatewaySchema.parse(report).type, 'completion');
});

test('node→gateway: rejects unknown message types and bad jobId', () => {
  assert.throws(() => nodeToGatewaySchema.parse({ type: 'nope' }));
  assert.throws(() => nodeToGatewaySchema.parse({ type: 'token', jobId: '0x1234', content: 'x' }));
});

test('gateway→node: challenge, ack, and job_assignment parse', () => {
  assert.equal(gatewayToNodeSchema.parse({ type: 'challenge', nonce: 'abc' }).type, 'challenge');
  assert.equal(gatewayToNodeSchema.parse({ type: 'hello_ack', ok: true }).type, 'hello_ack');

  const spec = identify(
    jobSpecSchema.parse({
      model: 'llama',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 64,
      temperature: 0,
      stream: false,
      requesterWallet: wallet,
      maxPricePerTokenWei: '1000000000',
      minReputation: 7000,
      createdAt: 1,
      deadline: 2,
    }),
  );
  const assignment = {
    type: 'job_assignment' as const,
    spec,
    agreedPricePerTokenWei: '900000000',
  };
  const parsed = gatewayToNodeSchema.parse(JSON.parse(JSON.stringify(assignment)));
  assert.equal(parsed.type, 'job_assignment');
});
