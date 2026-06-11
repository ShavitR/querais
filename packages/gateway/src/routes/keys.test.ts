import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { registerKeys, TERMS_URL, PRIVACY_URL } from './keys.js';

const ADMIN = 'admin-test';
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function fixture(): FastifyInstance {
  const deps = {
    config: { adminToken: ADMIN },
    hardening: { quotaTiers: { free: {}, pro: {} } },
    keyStore: { issue: (_wallet: string, tier: string) => `sk-test-${tier}` },
  } as unknown as GatewayDeps;
  const app = Fastify();
  registerKeys(app, deps);
  return app;
}

test('POST /v1/keys cannot answer without the disclosure URLs attached', async () => {
  const app = fixture();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { 'x-admin-token': ADMIN },
    payload: { wallet: WALLET },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Record<string, string>;
  assert.equal(body.api_key, 'sk-test-free');
  assert.equal(body.wallet, WALLET.toLowerCase());
  assert.equal(body.tier, 'free');
  // Slice 9 acceptance: no key is ever issued without terms/privacy in the body.
  assert.equal(body.terms, TERMS_URL);
  assert.equal(body.privacy, PRIVACY_URL);
  assert.match(body.terms, /^https:\/\/.+TERMS\.md$/);
  assert.match(body.privacy, /^https:\/\/.+PRIVACY\.md$/);
});

test('POST /v1/keys stays admin-gated and validates wallet/tier', async () => {
  const app = fixture();
  const noAuth = await app.inject({ method: 'POST', url: '/v1/keys', payload: { wallet: WALLET } });
  assert.equal(noAuth.statusCode, 401);

  const badWallet = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { 'x-admin-token': ADMIN },
    payload: { wallet: '0x123' },
  });
  assert.equal(badWallet.statusCode, 400);

  const badTier = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { 'x-admin-token': ADMIN },
    payload: { wallet: WALLET, tier: 'whale' },
  });
  assert.equal(badTier.statusCode, 400);

  const pro = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { 'x-admin-token': ADMIN },
    payload: { wallet: WALLET, tier: 'pro' },
  });
  assert.equal(pro.statusCode, 200);
  assert.equal((pro.json() as { tier: string }).tier, 'pro');
});
