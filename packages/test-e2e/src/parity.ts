import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { startHarness } from './harness.js';

/**
 * OpenAI drop-in parity: the *official* `openai` SDK, pointed at the QueraIS gateway
 * with only a baseURL change, must work unmodified — buffered chat, streaming chat,
 * and models.list(). This is the headline DX promise ("change one line").
 */
export async function runOpenAiParityCase(): Promise<void> {
  const h = await startHarness(); // ChainSettlement + MockBackend, model 'mock-model'
  try {
    const client = new OpenAI({ baseURL: `${h.baseUrl}/v1`, apiKey: h.apiKey });

    // 1. Buffered completion
    const completion = await client.chat.completions.create({
      model: 'mock-model',
      messages: [{ role: 'user', content: 'hello world' }],
      max_tokens: 50,
    });
    assert.equal(completion.object, 'chat.completion');
    assert.match(completion.choices[0]?.message.content ?? '', /You said: hello world/);
    assert.ok((completion.usage?.total_tokens ?? 0) > 0, 'usage reported');

    // 2. Streaming completion
    const stream = await client.chat.completions.create({
      model: 'mock-model',
      messages: [{ role: 'user', content: 'stream this' }],
      stream: true,
      max_tokens: 50,
    });
    let streamed = '';
    for await (const chunk of stream) {
      streamed += chunk.choices[0]?.delta?.content ?? '';
    }
    assert.match(streamed, /You said: stream this/);

    // 3. Models listing
    const models = await client.models.list();
    const ids = models.data.map((m) => m.id);
    assert.ok(ids.includes('mock-model'), 'mock-model listed via openai client');
  } finally {
    await h.stop();
  }
}
