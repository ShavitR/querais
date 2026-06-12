import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { encryptKey, decryptKey, loadOrCreateKey } from './keystore.js';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

test('encrypt → decrypt round-trips the private key', () => {
  const ks = encryptKey(PK, 'hunter2');
  assert.equal(ks.address, privateKeyToAccount(PK).address);
  assert.equal(decryptKey(ks, 'hunter2'), PK);
});

test('decrypt with the wrong password throws an actionable error, not a raw crypto trace', () => {
  const ks = encryptKey(PK, 'right');
  assert.throws(
    () => decryptKey(ks, 'wrong'),
    (e: Error) => {
      assert.match(e.message, /wrong DAEMON_KEYSTORE_PASSWORD/);
      assert.match(e.message, new RegExp(ks.address)); // names the wallet at risk
      assert.doesNotMatch(e.message, /unable to authenticate data/); // raw crypto error hidden
      return true;
    },
  );
});

test('loadOrCreateKey creates then reloads the same key', () => {
  const path = join(tmpdir(), `querais-ks-${process.pid}-${Date.now()}.json`);
  try {
    const first = loadOrCreateKey(path, 'pw');
    assert.equal(first.created, true);
    const second = loadOrCreateKey(path, 'pw');
    assert.equal(second.created, false);
    assert.equal(second.privateKey, first.privateKey);
    assert.equal(second.address, first.address);
  } finally {
    rmSync(path, { force: true });
  }
});
