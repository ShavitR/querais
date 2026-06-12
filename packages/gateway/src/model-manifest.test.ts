import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { signModelManifest, verifyModelManifest } from '@querais/shared';
import { loadModelManifest } from './model-manifest.js';
import { registerModels } from './routes/models.js';
import type { GatewayDeps } from './deps.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function withTempFile(content: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'querais-manifest-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, content, 'utf8');
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadModelManifest accepts a valid file', () => {
  withTempFile(
    JSON.stringify({ models: { 'gemma3:4b': { digest: DIGEST, note: 'pulled 2026-06-01' } } }),
    (path) => {
      const manifest = loadModelManifest(path);
      assert.equal(manifest.models['gemma3:4b']?.digest, DIGEST);
    },
  );
});

test('loadModelManifest fails fast on every malformed input', () => {
  // Missing file — boot must die, not limp on unenforced.
  assert.throws(() => loadModelManifest(join(tmpdir(), 'querais-no-such-manifest.json')), {
    message: /cannot read/,
  });
  withTempFile('{not json', (path) => {
    assert.throws(() => loadModelManifest(path), { message: /not valid JSON/ });
  });
  withTempFile(JSON.stringify({ models: { m: { digest: 'sha256:tooShort' } } }), (path) => {
    assert.throws(() => loadModelManifest(path), { message: /failed validation/ });
  });
  // Operator typo at the top level (e.g. "model" instead of "models").
  withTempFile(JSON.stringify({ models: {}, model: { m: { digest: DIGEST } } }), (path) => {
    assert.throws(() => loadModelManifest(path), { message: /failed validation/ });
  });
  // Empty manifest = enforcing nothing; refuse rather than mislead.
  withTempFile(JSON.stringify({ models: {} }), (path) => {
    assert.throws(() => loadModelManifest(path), { message: /empty "models" map/ });
  });
});

test('GET /v1/models/manifest: 404 unconfigured, signed manifest otherwise', async () => {
  const pool = { availableModels: () => [] };

  // Unconfigured — route must 404 so daemons know enforcement is off.
  const bare = Fastify();
  registerModels(bare, { pool } as unknown as GatewayDeps);
  const miss = await bare.inject({ method: 'GET', url: '/v1/models/manifest' });
  assert.equal(miss.statusCode, 404);

  // Configured — returns the boot-signed manifest, verifiable offline.
  const account = privateKeyToAccount(
    // Hardhat dev account #0 — public constant, test-only.
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  );
  const modelManifest = await signModelManifest(account, account.address, {
    'gemma3:4b': { digest: DIGEST },
  });
  const app = Fastify();
  registerModels(app, { pool, modelManifest } as unknown as GatewayDeps);
  const hit = await app.inject({ method: 'GET', url: '/v1/models/manifest' });
  assert.equal(hit.statusCode, 200);
  const body = hit.json() as typeof modelManifest;
  assert.equal(body.signer, account.address);
  assert.equal(body.models['gemma3:4b']?.digest, DIGEST);
  assert.equal(await verifyModelManifest(body), true);
});
