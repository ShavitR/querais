import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import { Faucet, FaucetError, type QaisDistributor } from './faucet.js';

const ADDR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

function recordingDistributor(): QaisDistributor & { calls: Array<[Address, bigint]> } {
  const calls: Array<[Address, bigint]> = [];
  return {
    calls,
    async transfer(to, amount) {
      calls.push([to, amount]);
      return ('0x' + 'ab'.repeat(32)) as Hex;
    },
  };
}

test('claim dispenses the configured amount once', async () => {
  const dist = recordingDistributor();
  const faucet = new Faucet(dist, 100n);
  const tx = await faucet.claim(ADDR);
  assert.match(tx, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(dist.calls, [[ADDR, 100n]]);
  assert.equal(faucet.hasClaimed(ADDR), true);
});

test('second claim from the same address is refused (Sybil throttle)', async () => {
  const dist = recordingDistributor();
  const faucet = new Faucet(dist, 100n);
  await faucet.claim(ADDR);
  await assert.rejects(faucet.claim(ADDR), FaucetError);
  assert.equal(dist.calls.length, 1); // no second transfer
});

test('a failed transfer is not counted as claimed (retry allowed)', async () => {
  let attempts = 0;
  const dist: QaisDistributor = {
    async transfer() {
      attempts += 1;
      if (attempts === 1) throw new Error('rpc blip');
      return ('0x' + 'cd'.repeat(32)) as Hex;
    },
  };
  const faucet = new Faucet(dist, 50n);
  await assert.rejects(faucet.claim(ADDR));
  assert.equal(faucet.hasClaimed(ADDR), false);
  await faucet.claim(ADDR); // retry succeeds
  assert.equal(faucet.hasClaimed(ADDR), true);
});
