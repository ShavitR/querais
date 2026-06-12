import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { signModelManifest } from '@querais/shared';
import { httpBaseFromGatewayWs, manifestSelfCheck } from './manifest-check.js';
import { mockModelDigest } from './inference/mock.js';

const logger = pino({ level: 'silent' });

// Hardhat dev account #0 — public constant, test-only. Plays the gateway/settler.
const gateway = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);

const GOOD = mockModelDigest('mock-model');
const PINNED_OTHER = `sha256:${'d'.repeat(64)}`;

function stubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    for (const [suffix, make] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return make();
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test('httpBaseFromGatewayWs derives the HTTP base', () => {
  assert.equal(httpBaseFromGatewayWs('ws://localhost:8787/node'), 'http://localhost:8787');
  assert.equal(
    httpBaseFromGatewayWs('wss://querais-gateway.fly.dev/node'),
    'https://querais-gateway.fly.dev',
  );
});

test('404 manifest (no enforcement) and unreachable gateway both mean no skips', async () => {
  const fourOhFour = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model'],
    modelDigests: { 'mock-model': GOOD },
    logger,
    fetchImpl: stubFetch({}),
  });
  assert.deepEqual(fourOhFour.skipped, []);

  const down = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model'],
    logger,
    fetchImpl: (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(down.skipped, []);
});

test('verified manifest: matching digest passes, mismatch and unpinned are sorted correctly', async () => {
  const manifest = await signModelManifest(gateway, gateway.address, {
    'mock-model': { digest: GOOD },
    'pinned-other': { digest: PINNED_OTHER },
  });
  const result = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model', 'pinned-other', 'free-model'],
    modelDigests: { 'mock-model': GOOD, 'pinned-other': mockModelDigest('pinned-other') },
    logger,
    fetchImpl: stubFetch({
      '/v1/models/manifest': () => json(manifest),
      '/v1/credit/info': () => json({ settler: gateway.address }),
    }),
  });
  // mock-model matches its pin; pinned-other doesn't; free-model is unpinned.
  assert.deepEqual(result.skipped, ['pinned-other']);
  assert.ok(result.manifest, 'verified manifest is returned');
});

test('a manifest not signed by the settler is ignored (no skips, no manifest)', async () => {
  const imposter = privateKeyToAccount(
    // Hardhat dev account #1 — public constant, test-only.
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  );
  const manifest = await signModelManifest(imposter, imposter.address, {
    'mock-model': { digest: PINNED_OTHER },
  });
  const result = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model'],
    modelDigests: { 'mock-model': GOOD },
    logger,
    fetchImpl: stubFetch({
      '/v1/models/manifest': () => json(manifest),
      // The gateway's real settler is someone else entirely.
      '/v1/credit/info': () => json({ settler: gateway.address }),
    }),
  });
  assert.deepEqual(result.skipped, []);
  assert.equal(result.manifest, undefined);
});

test('a tampered manifest (valid signer field, bad signature) is ignored', async () => {
  const genuine = await signModelManifest(gateway, gateway.address, {
    'mock-model': { digest: GOOD },
  });
  // Same signature, different content — recovery won't match the claimed signer.
  const tampered = { ...genuine, models: { 'mock-model': { digest: PINNED_OTHER } } };
  const result = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model'],
    modelDigests: { 'mock-model': GOOD },
    logger,
    fetchImpl: stubFetch({
      '/v1/models/manifest': () => json(tampered),
      '/v1/credit/info': () => json({ settler: gateway.address }),
    }),
  });
  assert.deepEqual(result.skipped, []);
  assert.equal(result.manifest, undefined);
});

test('pinned model with no local digest is skipped', async () => {
  const manifest = await signModelManifest(gateway, gateway.address, {
    'mock-model': { digest: GOOD },
  });
  const result = await manifestSelfCheck({
    gatewayHttpBase: 'http://gw',
    served: ['mock-model'],
    // No modelDigests at all (backend can't report them).
    logger,
    fetchImpl: stubFetch({
      '/v1/models/manifest': () => json(manifest),
      '/v1/credit/info': () => json({ settler: gateway.address }),
    }),
  });
  assert.deepEqual(result.skipped, ['mock-model']);
});
