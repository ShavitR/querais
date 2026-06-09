import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  hashSpendingCap,
  recoverSpendingCapSigner,
  signSpendingCap,
  signedSpendingCapSchema,
  spendingCapDomain,
  toSignedSpendingCapWire,
  toSpendingCap,
  type SpendingCap,
} from './spending-cap.js';

// Deterministic test key (Hardhat account #0; testnet/dev only).
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(PK);
const VERIFYING = '0x000000000000000000000000000000000000c0de' as Address;

function sampleCap(): SpendingCap {
  return {
    requester: account.address,
    settler: '0x00000000000000000000000000000000000000a1' as Address,
    maxSpendWei: parseEther('1000'),
    nonce: 7n,
    deadline: 1_900_000_000n,
  };
}

test('sign → recover yields the signer address', async () => {
  const domain = spendingCapDomain(421614, VERIFYING);
  const cap = sampleCap();
  const sig = await signSpendingCap(account, cap, domain);
  const recovered = await recoverSpendingCapSigner(cap, domain, sig);
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test('hashSpendingCap is deterministic and domain-bound', async () => {
  const cap = sampleCap();
  const a = hashSpendingCap(cap, spendingCapDomain(421614, VERIFYING));
  const a2 = hashSpendingCap(cap, spendingCapDomain(421614, VERIFYING));
  const b = hashSpendingCap(cap, spendingCapDomain(31337, VERIFYING)); // different chainId
  assert.equal(a, a2);
  assert.notEqual(a, b);
});

test('tampering with the cap breaks recovery', async () => {
  const domain = spendingCapDomain(421614, VERIFYING);
  const cap = sampleCap();
  const sig = await signSpendingCap(account, cap, domain);
  const tampered = { ...cap, maxSpendWei: cap.maxSpendWei + 1n };
  const recovered = await recoverSpendingCapSigner(tampered, domain, sig);
  assert.notEqual(recovered.toLowerCase(), account.address.toLowerCase());
});

test('wire round-trip preserves bigint fields', () => {
  const cap = sampleCap();
  const sig = '0xabcdef';
  const wire = toSignedSpendingCapWire(cap, sig);
  assert.equal(wire.maxSpendWei, cap.maxSpendWei.toString());
  const parsed = toSpendingCap(wire);
  assert.deepEqual(parsed.cap, cap);
  assert.equal(parsed.signature, sig);
});

test('signedSpendingCapSchema accepts valid and rejects malformed', () => {
  const cap = sampleCap();
  const wire = toSignedSpendingCapWire(cap, '0xdeadbeef');
  assert.equal(signedSpendingCapSchema.safeParse(wire).success, true);
  assert.equal(
    signedSpendingCapSchema.safeParse({ ...wire, maxSpendWei: 'not-a-number' }).success,
    false,
  );
  assert.equal(signedSpendingCapSchema.safeParse({ ...wire, requester: '0x123' }).success, false);
});
