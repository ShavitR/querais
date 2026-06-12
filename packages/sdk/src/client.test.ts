import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GATEWAY_URL, QueraisClient } from './client.js';

const realFetch = globalThis.fetch;
function setFetch(fn: (url?: string) => Promise<Response>): void {
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

test('chatStream() surfaces an in-band gateway error frame instead of ending silently', async () => {
  // The gateway streams HTTP 200 then an in-band error frame when no node can serve.
  const frames = [
    'data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ error: { message: 'No eligible node can serve "m"' } }) + '\n\n',
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
    await assert.rejects(
      (async () => {
        for await (const _ of c.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' })) {
          /* drain */
        }
      })(),
      /No eligible node can serve/,
    );
  } finally {
    restore();
  }
});

test('sessionStatus() returns the parsed session view', async () => {
  setFetch(
    async () =>
      new Response(
        JSON.stringify({
          requester: '0xreq',
          settler: '0xset',
          session: {
            nonce: '1',
            maxSpendWei: '100',
            deadline: '4000000000',
            spentAgainstWei: '40',
            capRemainingWei: '60',
          },
          credit: { balanceWei: '500' },
          pendingDebits: { count: 2, totalWei: '10' },
          headroomWei: '50',
        }),
        { status: 200 },
      ),
  );
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    const s = await c.sessionStatus();
    assert.equal(s.session?.capRemainingWei, '60');
    assert.equal(s.pendingDebits.count, 2);
    assert.equal(s.headroomWei, '50');
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

test('a connection failure becomes a legible error naming the gateway + QUERAIS_BASE_URL', async () => {
  // Node's fetch throws `TypeError: fetch failed` with the real reason on `.cause`.
  setFetch(async () => {
    throw Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:8787'),
    });
  });
  try {
    const c = new QueraisClient({ baseUrl: 'http://127.0.0.1:8787', apiKey: 'k' });
    await assert.rejects(c.nodes(), (e: Error) => {
      assert.match(e.message, /could not reach the gateway at http:\/\/127\.0\.0\.1:8787/);
      assert.match(e.message, /QUERAIS_BASE_URL/);
      assert.match(e.message, /ECONNREFUSED/); // the underlying cause is surfaced, not hidden
      return true;
    });
  } finally {
    restore();
  }
});

test('read methods throw a typed HTTP error (not an opaque JSON parse) on a non-ok response', async () => {
  setFetch(async () => new Response('upstream boom', { status: 502 }));
  try {
    const c = new QueraisClient({ baseUrl: 'http://x', apiKey: 'k' });
    await assert.rejects(c.nodes(), /QueraIS nodes failed: HTTP 502/);
    await assert.rejects(c.models(), /QueraIS models failed: HTTP 502/);
    await assert.rejects(c.stats(), /QueraIS stats failed: HTTP 502/);
  } finally {
    restore();
  }
});

test('DEFAULT_GATEWAY_URL points at the hosted gateway', () => {
  assert.equal(DEFAULT_GATEWAY_URL, 'https://querais-gateway.fly.dev');
});

test('baseUrl is optional and defaults to the hosted gateway', async () => {
  let calledUrl = '';
  setFetch(async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  try {
    const c = new QueraisClient({ apiKey: 'k' }); // no baseUrl supplied
    await c.nodes();
    assert.equal(calledUrl, `${DEFAULT_GATEWAY_URL}/v1/nodes`);
  } finally {
    restore();
  }
});
