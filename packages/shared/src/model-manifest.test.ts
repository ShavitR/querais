import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MODEL_DIGEST_REGEX,
  canonicalModelManifestJson,
  modelManifestSchema,
  signModelManifest,
  signedModelManifestSchema,
  verifyModelManifest,
  type SignedModelManifest,
} from './model-manifest.js';

// Hardhat dev account #0 — public constant, test-only.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(KEY);

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

test('canonical JSON sorts model keys and fixes field order', () => {
  const a = canonicalModelManifestJson({
    'llama3:8b': { digest: DIGEST_B, note: 'second' },
    'gemma3:4b': { digest: DIGEST_A },
  });
  const b = canonicalModelManifestJson({
    'gemma3:4b': { digest: DIGEST_A },
    'llama3:8b': { note: 'second', digest: DIGEST_B },
  });
  assert.equal(a, b);
  assert.equal(
    a,
    `{"models":{"gemma3:4b":{"digest":"${DIGEST_A}"},"llama3:8b":{"digest":"${DIGEST_B}","note":"second"}}}`,
  );
});

test('sign → verify round-trip; tampering or wrong signer fails', async () => {
  const models = { 'gemma3:4b': { digest: DIGEST_A } };
  const signed = await signModelManifest(account, account.address, models);
  assert.equal(signed.signer, account.address);
  assert.equal(await verifyModelManifest(signed), true);

  // Wire form parses back cleanly.
  assert.doesNotThrow(() => signedModelManifestSchema.parse(JSON.parse(JSON.stringify(signed))));

  // Tampered digest → invalid.
  const tampered: SignedModelManifest = {
    ...signed,
    models: { 'gemma3:4b': { digest: DIGEST_B } },
  };
  assert.equal(await verifyModelManifest(tampered), false);

  // Claimed signer differs from recovered → invalid.
  const wrongSigner: SignedModelManifest = {
    ...signed,
    signer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  };
  assert.equal(await verifyModelManifest(wrongSigner), false);

  // Garbage signature → false, not throw.
  assert.equal(await verifyModelManifest({ ...signed, signature: '0xdead' }), false);
});

test('schema rejects bad digests and unknown top-level keys', () => {
  assert.equal(MODEL_DIGEST_REGEX.test(DIGEST_A), true);
  assert.equal(MODEL_DIGEST_REGEX.test(`SHA256:${'a'.repeat(64)}`), false);
  assert.equal(MODEL_DIGEST_REGEX.test(`sha256:${'a'.repeat(63)}`), false);

  assert.equal(modelManifestSchema.safeParse({ models: {} }).success, true);
  assert.equal(
    modelManifestSchema.safeParse({ models: { m: { digest: 'sha256:xyz' } } }).success,
    false,
  );
  assert.equal(
    modelManifestSchema.safeParse({ models: {}, extra: 1 }).success,
    false,
    'strict schema flags operator typos at the top level',
  );
});
