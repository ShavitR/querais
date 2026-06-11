import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { registerStatus, type PublicStatus } from './status.js';

/** The routes only touch chain/pool/jobs/nodeFlags — a mutable stub deps is enough. */
interface StubState {
  rpcUp: boolean;
  nodes: number;
  jobs24h: number;
  lastSettledAt: number | undefined;
  openFlags: number;
  computeCalls: number;
}

function fixture(overrides: Partial<StubState> = {}): { app: FastifyInstance; state: StubState } {
  const state: StubState = {
    rpcUp: true,
    nodes: 2,
    jobs24h: 5,
    lastSettledAt: Date.now() - 30_000,
    openFlags: 0,
    computeCalls: 0,
    ...overrides,
  };
  const deps = {
    chain: {
      latestBlockTimestamp: () => {
        state.computeCalls += 1;
        return state.rpcUp ? Promise.resolve(1n) : Promise.reject(new Error('rpc down'));
      },
    },
    pool: { size: () => state.nodes },
    jobs: { countSince: () => state.jobs24h, lastSettledAt: () => state.lastSettledAt },
    nodeFlags: { openCount: () => state.openFlags },
  } as unknown as GatewayDeps;
  const app = Fastify();
  registerStatus(app, deps);
  return { app, state };
}

test('GET /v1/status returns the public shape and nothing sensitive', async () => {
  const { app } = fixture({ openFlags: 1 });
  const res = await app.inject({ method: 'GET', url: '/v1/status' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as PublicStatus;
  assert.equal(body.status, 'ok');
  assert.equal(body.nodes, 2);
  assert.equal(body.rpcOk, true);
  assert.equal(body.jobs24h, 5);
  assert.ok(typeof body.lastSettlementAgeSeconds === 'number');
  assert.ok((body.lastSettlementAgeSeconds as number) >= 29);
  assert.ok(body.uptimeSeconds >= 0);
  assert.equal(body.openIncidents, 1);
  // The public surface must stay public: no balances, no wallets, no flag details.
  assert.deepEqual(Object.keys(body).sort(), [
    'jobs24h',
    'lastSettlementAgeSeconds',
    'nodes',
    'openIncidents',
    'rpcOk',
    'status',
    'uptimeSeconds',
  ]);
});

test('degraded when RPC is down or when 0 nodes with recent jobs; empty devnet stays ok', async () => {
  const rpcDown = fixture({ rpcUp: false });
  let body = (await rpcDown.app.inject({ method: 'GET', url: '/v1/status' })).json() as PublicStatus;
  assert.equal(body.status, 'degraded');
  assert.equal(body.rpcOk, false);

  const noNodes = fixture({ nodes: 0, jobs24h: 3 });
  body = (await noNodes.app.inject({ method: 'GET', url: '/v1/status' })).json() as PublicStatus;
  assert.equal(body.status, 'degraded');

  // 0 nodes but also 0 jobs (a fresh deployment) is not an incident.
  const empty = fixture({ nodes: 0, jobs24h: 0, lastSettledAt: undefined });
  body = (await empty.app.inject({ method: 'GET', url: '/v1/status' })).json() as PublicStatus;
  assert.equal(body.status, 'ok');
  assert.equal(body.lastSettlementAgeSeconds, null);
});

test('the 5 s cache absorbs repeat polls (one compute for back-to-back requests)', async () => {
  const { app, state } = fixture();
  await app.inject({ method: 'GET', url: '/v1/status' });
  await app.inject({ method: 'GET', url: '/v1/status' });
  await app.inject({ method: 'GET', url: '/v1/status' });
  assert.equal(state.computeCalls, 1);
});

test('GET /status serves the HTML page that polls /v1/status', async () => {
  const { app } = fixture();
  const res = await app.inject({ method: 'GET', url: '/status' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/html/);
  assert.ok(res.body.includes('QueraIS Status'));
  assert.ok(res.body.includes("fetch('/v1/status')"));
});
