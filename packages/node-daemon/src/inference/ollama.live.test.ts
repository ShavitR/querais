import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaBackend } from './ollama.js';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const SMOKE_MODEL = process.env.SMOKE_MODEL ?? 'gemma3:4b';

/**
 * Live smoke test against a real Ollama. Skips (does not fail) when Ollama is not
 * running or the model isn't pulled, so CI without Ollama stays green. Run locally
 * with Ollama up to exercise genuine streaming inference + token counting.
 */
test('OllamaBackend streams real tokens', { timeout: 180_000 }, async (t) => {
  const backend = new OllamaBackend(OLLAMA_URL);
  if (!(await backend.isAvailable())) {
    t.skip(`Ollama not reachable at ${OLLAMA_URL}`);
    return;
  }
  const models = await backend.listModels();
  if (!models.includes(SMOKE_MODEL)) {
    t.skip(`model ${SMOKE_MODEL} not pulled (have: ${models.join(', ')})`);
    return;
  }

  const chunks: string[] = [];
  const result = await backend.generate(
    {
      model: SMOKE_MODEL,
      messages: [{ role: 'user', content: 'Say hi in three words.' }],
      maxTokens: 16,
      temperature: 0,
    },
    (chunk) => chunks.push(chunk.content),
  );

  assert.ok(result.content.length > 0, 'expected non-empty content');
  assert.ok(result.completionTokens > 0, 'expected eval_count > 0');
  assert.equal(chunks.join(''), result.content, 'streamed chunks reconstruct the full text');
  assert.ok(['stop', 'length'].includes(result.finishReason));
});
