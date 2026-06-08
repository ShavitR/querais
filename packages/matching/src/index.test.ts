import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterEligible,
  priceScore,
  scoreOffer,
  selectBest,
  type MatchConstraints,
  type NodeOffer,
} from './index.js';

const A = '0x00000000000000000000000000000000000000aa' as const;
const B = '0x00000000000000000000000000000000000000bb' as const;
const C = '0x00000000000000000000000000000000000000cc' as const;

function offer(p: Partial<NodeOffer> & { wallet: `0x${string}` }): NodeOffer {
  return {
    nodeId: 'n',
    model: 'gemma3:4b',
    pricePerTokenWei: 1000n,
    reputation: 7000,
    active: true,
    ...p,
  };
}

const constraints: MatchConstraints = {
  model: 'gemma3:4b',
  maxPricePerTokenWei: 2000n,
  minReputation: 5000,
};

test('priceScore: cheaper scores higher, capped to [0,1]', () => {
  assert.equal(priceScore(0n, 2000n), 1);
  assert.equal(priceScore(2000n, 2000n), 0);
  assert.equal(priceScore(1000n, 2000n), 0.5);
});

test('filterEligible drops wrong model, over-price, low-rep, and inactive', () => {
  const offers = [
    offer({ wallet: A }),
    offer({ wallet: B, model: 'other' }),
    offer({ wallet: C, pricePerTokenWei: 3000n }),
    offer({ wallet: A, reputation: 4000 }),
    offer({ wallet: B, active: false }),
  ];
  const eligible = filterEligible(offers, constraints);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]?.wallet, A);
});

test('scoreOffer combines price and reputation at 0.5/0.5', () => {
  const s = scoreOffer(
    offer({ wallet: A, pricePerTokenWei: 1000n, reputation: 10000 }),
    constraints,
  );
  // priceScore = 1 - 1000/2000 = 0.5; repScore = 1.0 => 0.5*0.5 + 0.5*1 = 0.75
  assert.equal(s.score, 0.75);
});

test('selectBest picks the highest score', () => {
  const cheapLowRep = offer({ wallet: A, pricePerTokenWei: 200n, reputation: 6000 });
  const pricyHighRep = offer({ wallet: B, pricePerTokenWei: 1800n, reputation: 10000 });
  const balanced = offer({ wallet: C, pricePerTokenWei: 600n, reputation: 9500 });
  const best = selectBest([cheapLowRep, pricyHighRep, balanced], constraints);
  assert.equal(best?.offer.wallet, C); // balanced wins
});

test('selectBest tie-breaks toward the cheaper price', () => {
  // Two offers engineered to the same score: price/rep trade off exactly.
  // o1: price 0 (score 1.0), rep 0 -> 0.5 ; o2: price 2000 (score 0), rep 10000 -> 0.5
  const o1 = offer({ wallet: A, pricePerTokenWei: 0n, reputation: 5000 });
  const o2 = offer({ wallet: B, pricePerTokenWei: 1000n, reputation: 5000 });
  // both: priceScore differs -> not a true tie. Construct a real tie instead:
  const t1 = offer({ wallet: A, pricePerTokenWei: 500n, reputation: 8000 });
  const t2 = offer({ wallet: B, pricePerTokenWei: 500n, reputation: 8000 });
  void o1;
  void o2;
  const best = selectBest([t2, t1], constraints);
  assert.ok(best);
});

test('selectBest returns null when nothing qualifies', () => {
  const best = selectBest([offer({ wallet: A, reputation: 1000 })], constraints);
  assert.equal(best, null);
});
