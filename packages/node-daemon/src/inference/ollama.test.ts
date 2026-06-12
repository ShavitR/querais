import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaBackend } from './ollama.js';

const realFetch = globalThis.fetch;
function restore(): void {
  globalThis.fetch = realFetch;
}
function mockFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: unknown) => handler(String(input))) as unknown as typeof fetch;
}

function pullStream(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

test('ensureModel skips the pull when the model is already present', async () => {
  let pulled = false;
  mockFetch((url) => {
    if (url.endsWith('/api/tags'))
      return new Response(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }), { status: 200 });
    if (url.endsWith('/api/pull')) {
      pulled = true;
      return new Response('', { status: 200 });
    }
    return new Response('', { status: 404 });
  });
  try {
    await new OllamaBackend('http://x').ensureModel('gemma3:4b');
    assert.equal(pulled, false);
  } finally {
    restore();
  }
});

test('ensureModel pulls and drains progress when the model is missing', async () => {
  let pulled = false;
  mockFetch((url) => {
    if (url.endsWith('/api/tags'))
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    if (url.endsWith('/api/pull')) {
      pulled = true;
      return pullStream(['{"status":"pulling manifest"}\n', '{"status":"success"}\n']);
    }
    return new Response('', { status: 404 });
  });
  try {
    await new OllamaBackend('http://x').ensureModel('llama3:8b');
    assert.equal(pulled, true);
  } finally {
    restore();
  }
});

test('modelDigests reads /api/tags and normalizes bare hex to sha256:…', async () => {
  const hex = 'c0ffee'.repeat(10) + 'beef'; // 64 hex chars
  mockFetch((url) => {
    if (url.endsWith('/api/tags'))
      return new Response(
        JSON.stringify({
          models: [
            { name: 'gemma3:4b', digest: hex },
            { name: 'llama3:8b', digest: `sha256:${hex}` },
            { name: 'no-digest' },
          ],
        }),
        { status: 200 },
      );
    return new Response('', { status: 404 });
  });
  try {
    const digests = await new OllamaBackend('http://x').modelDigests();
    assert.equal(digests['gemma3:4b'], `sha256:${hex}`, 'bare hex gets the prefix');
    assert.equal(digests['llama3:8b'], `sha256:${hex}`, 'prefixed digest kept as-is');
    assert.equal('no-digest' in digests, false, 'models without a digest are omitted');
  } finally {
    restore();
  }
});

test('ensureModel throws when the pull stream reports an error', async () => {
  mockFetch((url) => {
    if (url.endsWith('/api/tags'))
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    if (url.endsWith('/api/pull')) return pullStream(['{"error":"model not found"}\n']);
    return new Response('', { status: 404 });
  });
  try {
    await assert.rejects(new OllamaBackend('http://x').ensureModel('bogus:1b'));
  } finally {
    restore();
  }
});
