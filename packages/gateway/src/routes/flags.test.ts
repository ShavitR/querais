import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Address } from 'viem';
import { GatewayDb } from '../db/index.js';
import { NodeFlagStore } from '../db/node-flags.js';
import type { GatewayDeps } from '../deps.js';
import { registerFlags } from './flags.js';

const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const OTHER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const ADMIN = 'test-admin-token';

/** The routes only touch config.adminToken + nodeFlags — a stub deps is enough. */
function fixture(adminToken: string | undefined = ADMIN): {
  app: FastifyInstance;
  flags: NodeFlagStore;
} {
  const flags = new NodeFlagStore(new GatewayDb());
  const app = Fastify();
  registerFlags(app, { config: { adminToken }, nodeFlags: flags } as unknown as GatewayDeps);
  return { app, flags };
}

test('admin flag routes refuse without the token (and when none is configured)', async () => {
  const { app } = fixture();
  for (const headers of [{}, { 'x-admin-token': 'wrong' }]) {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/flags', headers });
    assert.equal(res.statusCode, 401);
    const review = await app.inject({
      method: 'POST',
      url: '/v1/admin/flags/1/review',
      headers,
      payload: { by: 'shavit' },
    });
    assert.equal(review.statusCode, 401);
  }
  // No adminToken configured → the route is sealed, not open.
  const sealed = fixture(undefined);
  const res = await sealed.app.inject({
    method: 'GET',
    url: '/v1/admin/flags',
    headers: { 'x-admin-token': '' },
  });
  assert.equal(res.statusCode, 401);
});

test('GET /v1/admin/flags lists open by default, filters, paginates', async () => {
  const { app, flags } = fixture();
  for (let i = 0; i < 3; i++) flags.add(NODE, 'layer-a:anomaly', `flag ${String(i)}`);
  flags.add(OTHER, 'pattern:truncation', 'other node');
  flags.markReviewed(flags.forWallet(NODE)[0]!.id, 'shavit');

  const auth = { 'x-admin-token': ADMIN };
  const open = await app.inject({ method: 'GET', url: '/v1/admin/flags', headers: auth });
  assert.equal(open.statusCode, 200);
  const openBody = open.json() as { flags: { id: number }[]; openCount: number };
  assert.equal(openBody.flags.length, 3);
  assert.equal(openBody.openCount, 3);

  const all = await app.inject({
    method: 'GET',
    url: '/v1/admin/flags?status=all',
    headers: auth,
  });
  assert.equal((all.json() as { flags: unknown[] }).flags.length, 4);

  const byWallet = await app.inject({
    method: 'GET',
    url: `/v1/admin/flags?wallet=${NODE}`,
    headers: auth,
  });
  assert.equal((byWallet.json() as { flags: unknown[] }).flags.length, 2);

  const page = await app.inject({
    method: 'GET',
    url: '/v1/admin/flags?status=all&limit=2&offset=2',
    headers: auth,
  });
  assert.equal((page.json() as { flags: unknown[] }).flags.length, 2);

  for (const bad of ['status=stale', 'wallet=nope', 'limit=-1', 'offset=x']) {
    const res = await app.inject({ method: 'GET', url: `/v1/admin/flags?${bad}`, headers: auth });
    assert.equal(res.statusCode, 400, `expected 400 for ?${bad}`);
  }
});

test('POST /v1/admin/flags/:id/review marks once; 404 unknown, 409 repeat, 400 no reviewer', async () => {
  const { app, flags } = fixture();
  flags.add(NODE, 'pattern:duplicate-output', 'identical output for 3 hashes');
  const id = flags.forWallet(NODE)[0]!.id;
  const auth = { 'x-admin-token': ADMIN };

  const ok = await app.inject({
    method: 'POST',
    url: `/v1/admin/flags/${String(id)}/review`,
    headers: auth,
    payload: { by: 'shavit', note: 'false positive' },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as { flag: { reviewedBy: string; reviewNote: string } };
  assert.equal(body.flag.reviewedBy, 'shavit');
  assert.equal(body.flag.reviewNote, 'false positive');

  const repeat = await app.inject({
    method: 'POST',
    url: `/v1/admin/flags/${String(id)}/review`,
    headers: auth,
    payload: { by: 'again' },
  });
  assert.equal(repeat.statusCode, 409);

  const missing = await app.inject({
    method: 'POST',
    url: '/v1/admin/flags/99999/review',
    headers: auth,
    payload: { by: 'nobody' },
  });
  assert.equal(missing.statusCode, 404);

  flags.add(NODE, 'layer-a:anomaly', 'fresh');
  const fresh = flags.list()[0]!.id;
  const noBy = await app.inject({
    method: 'POST',
    url: `/v1/admin/flags/${String(fresh)}/review`,
    headers: auth,
    payload: { note: 'who did this?' },
  });
  assert.equal(noBy.statusCode, 400);
  const badId = await app.inject({
    method: 'POST',
    url: '/v1/admin/flags/abc/review',
    headers: auth,
    payload: { by: 'shavit' },
  });
  assert.equal(badId.statusCode, 400);
});
