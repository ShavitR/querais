import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { MIGRATION_COUNT } from './migrations.js';
import { Faucet, FaucetError, type FaucetDistributor } from '../faucet.js';

const ADDR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

const noopDistributor: FaucetDistributor = {
  async transferQais() {
    return ('0x' + 'ab'.repeat(32)) as Hex;
  },
  async sendEth() {
    return ('0x' + 'cd'.repeat(32)) as Hex;
  },
};

function tmpDbPath(): string {
  return join(
    tmpdir(),
    `querais-db-${process.pid}-${Date.now()}-${Math.floor(performance.now())}.db`,
  );
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
}

test('migrations apply to user_version and are idempotent', () => {
  const path = tmpDbPath();
  try {
    const a = new GatewayDb(path);
    const v1 = a.conn.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(v1.user_version, MIGRATION_COUNT);
    a.close();

    // Re-opening runs the migration check again with nothing to apply.
    const b = new GatewayDb(path);
    const v2 = b.conn.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(v2.user_version, MIGRATION_COUNT);
    // Tables exist.
    const names = (
      b.conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    assert.ok(names.includes('api_keys'));
    assert.ok(names.includes('faucet_claims'));
    b.close();
  } finally {
    cleanup(path);
  }
});

test('faucet Sybil throttle survives a restart (the in-memory Set hole)', async () => {
  const path = tmpDbPath();
  try {
    const first = new GatewayDb(path);
    await new Faucet(first, noopDistributor, 100n, 5n).claim(ADDR);
    first.close();

    // Fresh process / connection: the claim must still be remembered.
    const second = new GatewayDb(path);
    const faucet = new Faucet(second, noopDistributor, 100n, 5n);
    assert.equal(faucet.hasClaimed(ADDR), true);
    await assert.rejects(faucet.claim(ADDR), FaucetError);
    second.close();
  } finally {
    cleanup(path);
  }
});
