import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueraisClient } from './client.js';

const realFetch = globalThis.fetch;
function setFetch(fn: () => Promise<Response>): void {
  globalThis.fetch = fn as unknown as typeof fetch;
}
function restore(): void {
  globalThis.fetch = realFetch;
}

test('chat() parses content, usage, and the job-id header', async () => {
  setFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi there' } }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
        { status: 200, headers: { 'x-querais-job-id': '0xabc' } },
      ),
  );
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    const r = await c.chat([{ role: 'user', content: 'hi' }], { model: 'm' });
    assert.equal(r.content, 'hi there');
    assert.equal(r.usage.total_tokens, 4);
    assert.equal(r.jobId, '0xabc');
  } finally {
    restore();
  }
});

test('models() returns the model ids', async () => {
  setFetch(
    async () => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 }),
  );
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    assert.deepEqual(await c.models(), ['a', 'b']);
  } finally {
    restore();
  }
});

test('chatStream() yields content deltas from SSE frames', async () => {
  const frames = [
    'data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: ' world' } }] }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const f of frames) ctrl.enqueue(enc.encode(f));
      ctrl.close();
    },
  });
  setFetch(async () => new Response(stream, { status: 200 }));
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    let out = '';
    for await (const d of c.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' })) out += d;
    assert.equal(out, 'Hello world');
  } finally {
    restore();
  }
});

test('chat() throws on a non-ok response', async () => {
  setFetch(async () => new Response('nope', { status: 401 }));
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    await assert.rejects(c.chat([{ role: 'user', content: 'hi' }], { model: 'm' }));
  } finally {
    restore();
  }
});
