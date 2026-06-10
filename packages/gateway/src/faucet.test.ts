import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { Faucet, FaucetError, type FaucetDistributor } from './faucet.js';
import { GatewayDb } from './db/index.js';

const ADDR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

function recordingDistributor(): FaucetDistributor & {
  qais: Array<[Address, bigint]>;
  eth: Array<[Address, bigint]>;
} {
  const qais: Array<[Address, bigint]> = [];
  const eth: Array<[Address, bigint]> = [];
  return {
    qais,
    eth,
    async transferQais(to, amount) {
      qais.push([to, amount]);
      return ('0x' + 'ab'.repeat(32)) as Hex;
    },
    async sendEth(to, amount) {
      eth.push([to, amount]);
      return ('0x' + 'cd'.repeat(32)) as Hex;
    },
  };
}

test('claim dispenses QAIS and ETH once', async () => {
  const dist = recordingDistributor();
  const faucet = new Faucet(new GatewayDb(), dist, 100n, 5n);
  const claim = await faucet.claim(ADDR);
  assert.match(claim.qaisTx, /^0x[0-9a-f]{64}$/);
  assert.match(claim.ethTx ?? '', /^0x[0-9a-f]{64}$/);
  assert.deepEqual(dist.qais, [[ADDR, 100n]]);
  assert.deepEqual(dist.eth, [[ADDR, 5n]]);
});

test('no ETH transfer when ethAmount is 0', async () => {
  const dist = recordingDistributor();
  const faucet = new Faucet(new GatewayDb(), dist, 100n, 0n);
  const claim = await faucet.claim(ADDR);
  assert.equal(claim.ethTx, undefined);
  assert.equal(dist.eth.length, 0);
});

test('second claim from the same address is refused', async () => {
  const dist = recordingDistributor();
  const faucet = new Faucet(new GatewayDb(), dist, 100n, 5n);
  await faucet.claim(ADDR);
  await assert.rejects(faucet.claim(ADDR), FaucetError);
  assert.equal(dist.qais.length, 1);
});

test('per-IP daily throttle blocks fresh addresses from the same source (survives restart)', async () => {
  const path = join(tmpdir(), `querais-faucet-ip-${process.pid}-${Date.now()}.db`);
  try {
    const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
    const first = new GatewayDb(path);
    const faucetA = new Faucet(first, recordingDistributor(), 100n, 0n, { ipDailyLimit: 2 });
    await faucetA.claim(addr(1), '203.0.113.7');
    await faucetA.claim(addr(2), '203.0.113.7');
    // Third claim from the same IP — fresh address, still refused.
    await assert.rejects(faucetA.claim(addr(3), '203.0.113.7'), FaucetError);
    // A different IP is unaffected.
    await faucetA.claim(addr(4), '198.51.100.9');
    first.close();

    // Restart: the IP throttle must persist (claims live in the DB, not memory).
    const second = new GatewayDb(path);
    const faucetB = new Faucet(second, recordingDistributor(), 100n, 0n, { ipDailyLimit: 2 });
    await assert.rejects(faucetB.claim(addr(5), '203.0.113.7'), FaucetError);
    second.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }
});

test('global daily cap bounds total drain across IPs and addresses', async () => {
  const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
  const faucet = new Faucet(new GatewayDb(), recordingDistributor(), 100n, 0n, {
    dailyCap: 2,
  });
  await faucet.claim(addr(1), '203.0.113.1');
  await faucet.claim(addr(2), '203.0.113.2');
  await assert.rejects(faucet.claim(addr(3), '203.0.113.3'), FaucetError);
});

test('balance guard refuses cleanly when the distributor cannot fund a claim', async () => {
  const dist = { ...recordingDistributor(), qaisBalance: async () => 50n };
  const faucet = new Faucet(new GatewayDb(), dist, 100n, 0n);
  await assert.rejects(faucet.claim(ADDR), /out of QAIS/);
  // Refusal must not burn the address's one claim.
  assert.equal(faucet.hasClaimed(ADDR), false);

  const ethDry = {
    ...recordingDistributor(),
    qaisBalance: async () => 1_000n,
    ethBalance: async () => 1n,
  };
  const faucet2 = new Faucet(new GatewayDb(), ethDry, 100n, 5n);
  await assert.rejects(faucet2.claim(ADDR), /out of gas ETH/);
});

test('a failed transfer is not counted as claimed (retry allowed)', async () => {
  let attempts = 0;
  const dist: FaucetDistributor = {
    async transferQais() {
      attempts += 1;
      if (attempts === 1) throw new Error('rpc blip');
      return ('0x' + 'ef'.repeat(32)) as Hex;
    },
    async sendEth() {
      return ('0x' + 'cd'.repeat(32)) as Hex;
    },
  };
  const faucet = new Faucet(new GatewayDb(), dist, 50n, 0n);
  await assert.rejects(faucet.claim(ADDR));
  assert.equal(faucet.hasClaimed(ADDR), false);
  await faucet.claim(ADDR);
  assert.equal(faucet.hasClaimed(ADDR), true);
});
