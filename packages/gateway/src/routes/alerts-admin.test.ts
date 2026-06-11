import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { registerAlertsAdmin } from './alerts-admin.js';

const ADMIN = 'test-admin-token';

/** The route only touches config.adminToken + alerts.deliverTest — stub deps suffice. */
function fixture(opts: {
  adminToken?: string | undefined;
  result?: { delivered: boolean; error?: string };
}): { app: FastifyInstance; calls: { count: number } } {
  const calls = { count: 0 };
  const deps = {
    config: { adminToken: 'adminToken' in opts ? opts.adminToken : ADMIN },
    alerts: {
      deliverTest: () => {
        calls.count += 1;
        return Promise.resolve(opts.result ?? { delivered: true });
      },
    },
  } as unknown as GatewayDeps;
  const app = Fastify();
  registerAlertsAdmin(app, deps);
  return { app, calls };
}

test('POST /v1/admin/alerts/test refuses without the token (and when none is configured)', async () => {
  const { app, calls } = fixture({});
  for (const headers of [{}, { 'x-admin-token': 'wrong' }]) {
    const res = await app.inject({ method: 'POST', url: '/v1/admin/alerts/test', headers });
    assert.equal(res.statusCode, 401);
  }
  // No adminToken configured → sealed, not open.
  const sealed = fixture({ adminToken: undefined });
  const res = await sealed.app.inject({
    method: 'POST',
    url: '/v1/admin/alerts/test',
    headers: { 'x-admin-token': '' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.count + sealed.calls.count, 0, 'sink never touched without auth');
});

test('a delivered test alert returns 200 {delivered: true}', async () => {
  const { app, calls } = fixture({});
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/alerts/test',
    headers: { 'x-admin-token': ADMIN },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { delivered: true });
  assert.equal(calls.count, 1);
});

test('a failed delivery returns 502 with the (redacted) error', async () => {
  const { app } = fixture({ result: { delivered: false, error: 'webhook host refused (401)' } });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/alerts/test',
    headers: { 'x-admin-token': ADMIN },
  });
  assert.equal(res.statusCode, 502);
  const body = res.json() as { delivered: boolean; error: string };
  assert.equal(body.delivered, false);
  assert.match(body.error, /refused/);
});
