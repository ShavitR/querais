import { test } from 'node:test';
import assert from 'node:assert/strict';
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
