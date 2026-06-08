import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoPrice } from './pricing.js';

const MEDIAN = 1000n;
const base = (over: Partial<Parameters<typeof computeAutoPrice>[0]> = {}) =>
  computeAutoPrice({
    marketMedianWei: MEDIAN,
    loadFraction: 0.5, // neutral (1.00)
    reputationBps: 8500, // neutral (1.00)
    electricityCostPerTokenWei: 0n,
    ...over,
  });

test('neutral load + reputation => median × 0.90', () => {
  assert.equal(base(), 900n);
});

test('low load discounts (×0.85), high load premiums (×1.25)', () => {
  assert.equal(base({ loadFraction: 0.1 }), 765n); // 900 × 0.85
  assert.equal(base({ loadFraction: 0.9 }), 1125n); // 900 × 1.25
});

test('reputation adjusts price up (>0.95) and down (<0.80)', () => {
  assert.equal(base({ reputationBps: 9600 }), 945n); // 900 × 1.05
  assert.equal(base({ reputationBps: 7000 }), 810n); // 900 × 0.90
});

test('electricity floor (cost × 1.20) overrides a lower computed price', () => {
  // base would be 900, but floor = 1000 × 1.20 = 1200
  assert.equal(base({ electricityCostPerTokenWei: 1000n }), 1200n);
});

test('price is capped at 2× the market median', () => {
  // floor (electricity 2000 ×1.2 = 2400) would exceed the 2× median ceiling (2000)
  assert.equal(base({ electricityCostPerTokenWei: 2000n }), 2000n);
});

test('loadFraction is clamped to [0,1]', () => {
  assert.equal(base({ loadFraction: -5 }), 765n); // treated as 0 -> ×0.85
  assert.equal(base({ loadFraction: 5 }), 1125n); // treated as 1 -> ×1.25
});
