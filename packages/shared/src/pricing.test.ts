import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import {
  FEE_BPS,
  lockAmount,
  paymentFor,
  per1kQaisToWeiPerToken,
  splitPayment,
} from './pricing.js';

test('per1kQaisToWeiPerToken converts QAIS-per-1k to wei-per-token', () => {
  // 1 QAIS / 1000 tokens => 1e18 / 1000 = 1e15 wei per token
  assert.equal(per1kQaisToWeiPerToken(1), 10n ** 15n);
  assert.equal(per1kQaisToWeiPerToken(0.5), 5n * 10n ** 14n);
});

test('lockAmount and paymentFor are integer products', () => {
  const maxPrice = parseEther('0.001');
  assert.equal(lockAmount(maxPrice, 1000), parseEther('1'));
  assert.equal(paymentFor(parseEther('0.0008'), 500), parseEther('0.4'));
});

test('splitPayment matches the on-chain 95/5 basis-point math', () => {
  const payment = parseEther('0.4');
  const { providerPay, fee } = splitPayment(payment);
  assert.equal(fee, parseEther('0.02')); // 5%
  assert.equal(providerPay, parseEther('0.38')); // 95%
  assert.equal(providerPay + fee, payment); // conservation
  assert.equal(FEE_BPS, 500);
});

test('splitPayment rounds the fee down like Solidity integer division', () => {
  // 19 wei * 500 / 10000 = 0 (floor) -> provider gets all 19, conservation holds
  const { providerPay, fee } = splitPayment(19n);
  assert.equal(fee, 0n);
  assert.equal(providerPay, 19n);
  assert.equal(providerPay + fee, 19n);
});
