import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockBackend } from './mock.js';

test('MockBackend echoes deterministically with exact token counts', async () => {
  const backend = new MockBackend();
  const chunks: string[] = [];
  const result = await backend.generate(
    {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'hello there friend' }],
      maxTokens: 100,
      temperature: 0,
    },
    (chunk) => chunks.push(chunk.content),
  );

  assert.equal(result.content, 'You said: hello there friend');
  assert.equal(result.completionTokens, 5); // You said: hello there friend
  assert.equal(result.promptTokens, 3); // hello there friend
  assert.equal(result.finishReason, 'stop');
  assert.equal(chunks.join(''), result.content);
  assert.equal(chunks.length, 5); // one chunk per token
});

test('MockBackend truncates at maxTokens and reports finish_reason=length', async () => {
  const backend = new MockBackend();
  const result = await backend.generate(
    {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'a b c d e' }],
      maxTokens: 3,
      temperature: 0,
    },
    () => {},
  );
  // tokens of "You said: a b c d e" = 7, truncated to 3
  assert.equal(result.completionTokens, 3);
  assert.equal(result.content, 'You said: a');
  assert.equal(result.finishReason, 'length');
});

test('MockBackend reports availability and models', async () => {
  const backend = new MockBackend(['m1', 'm2']);
  assert.equal(await backend.isAvailable(), true);
  assert.deepEqual(await backend.listModels(), ['m1', 'm2']);
});
