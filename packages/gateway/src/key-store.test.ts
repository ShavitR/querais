import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address } from '@querais/shared';
import { ApiKeyStore } from './key-store.js';

const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

test('seeded keys resolve to their wallet', () => {
  const store = new ApiKeyStore(undefined, new Map([['sk-seed', WALLET]]));
  assert.equal(store.get('sk-seed'), WALLET.toLowerCase());
  assert.equal(store.get('nope'), undefined);
});

test('issue() mints a prefixed key bound to the (lowercased) wallet', () => {
  const store = new ApiKeyStore(undefined);
  const key = store.issue(WALLET);
  assert.match(key, /^sk-querais-[0-9a-f]{36}$/);
  assert.equal(store.get(key), WALLET.toLowerCase());
});

test('issued keys persist to file and reload in a new instance', () => {
  const path = join(tmpdir(), `querais-keys-${process.pid}-${Date.now()}.json`);
  try {
    const a = new ApiKeyStore(path);
    const key = a.issue(WALLET);
    const b = new ApiKeyStore(path); // fresh instance reads the file
    assert.equal(b.get(key), WALLET.toLowerCase());
  } finally {
    rmSync(path, { force: true });
  }
});
