import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address } from '@querais/shared';
import { ApiKeyStore } from './key-store.js';
import { GatewayDb } from './db/index.js';

const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

test('seeded keys resolve to their wallet', () => {
  const store = new ApiKeyStore(new GatewayDb(), new Map([['sk-seed', WALLET]]));
  assert.equal(store.get('sk-seed'), WALLET.toLowerCase());
  assert.equal(store.get('nope'), undefined);
});

test('issue() mints a prefixed key bound to the (lowercased) wallet', () => {
  const store = new ApiKeyStore(new GatewayDb());
  const key = store.issue(WALLET);
  assert.match(key, /^sk-querais-[0-9a-f]{36}$/);
  assert.equal(store.get(key), WALLET.toLowerCase());
});

test('issued keys persist to the DB and reload in a new instance', () => {
  const path = join(tmpdir(), `querais-keys-${process.pid}-${Date.now()}.db`);
  let a: GatewayDb | undefined;
  let b: GatewayDb | undefined;
  try {
    a = new GatewayDb(path);
    const key = new ApiKeyStore(a).issue(WALLET);
    a.close();
    a = undefined;
    b = new GatewayDb(path); // fresh connection reads the persisted row
    assert.equal(new ApiKeyStore(b).get(key), WALLET.toLowerCase());
  } finally {
    a?.close();
    b?.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});
