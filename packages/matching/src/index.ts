/**
 * @querais/matching — pure provider selection.
 *
 * Self-contained and side-effect free: it NEVER imports viem or touches the chain.
 * Given the offers currently in the gateway's pool and a job's constraints, it
 * filters, scores, and picks a winner. The gateway's dispatcher is the only thing
 * that turns that choice into on-chain transactions.
 *
 * MVP scorer: Score = 0.5·PriceScore + 0.5·ReputationScore (latency/capability and
 * the loyalty multiplier are deferred — they need live telemetry we don't collect yet).
 */

export const MATCHING_VERSION = '0.2.0';

export interface NodeOffer {
  wallet: `0x${string}`;
  nodeId: string;
  model: string;
  /** Price the node charges per token, in QAIS wei. */
  pricePerTokenWei: bigint;
  /** On-chain reputation in basis points of [0,1] (10000 == 1.0). */
  reputation: number;
  active: boolean;
}

export interface MatchConstraints {
  model: string;
  /** Max price the requester will pay per token, in QAIS wei. */
  maxPricePerTokenWei: bigint;
  /** Minimum acceptable reputation in basis points (0..10000). */
  minReputation: number;
}

export interface ScoredOffer {
  offer: NodeOffer;
  score: number;
  priceScore: number;
  reputationScore: number;
}

const PRICE_WEIGHT = 0.5;
const REPUTATION_WEIGHT = 0.5;

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** PriceScore: 1 at free, 0 at the requester's max price (cheaper = higher). */
export function priceScore(pricePerTokenWei: bigint, maxPricePerTokenWei: bigint): number {
  if (maxPricePerTokenWei <= 0n) return 1;
  return clamp01(1 - Number(pricePerTokenWei) / Number(maxPricePerTokenWei));
}

/** ReputationScore: reputation normalized to [0,1]. */
export function reputationScore(reputation: number): number {
  return clamp01(reputation / 10000);
}

export function scoreOffer(offer: NodeOffer, c: MatchConstraints): ScoredOffer {
  const ps = priceScore(offer.pricePerTokenWei, c.maxPricePerTokenWei);
  const rs = reputationScore(offer.reputation);
  return {
    offer,
    priceScore: ps,
    reputationScore: rs,
    score: PRICE_WEIGHT * ps + REPUTATION_WEIGHT * rs,
  };
}

/** Offers that can serve this job within the requester's constraints. */
export function filterEligible(offers: readonly NodeOffer[], c: MatchConstraints): NodeOffer[] {
  return offers.filter(
    (o) =>
      o.active &&
      o.model === c.model &&
      o.pricePerTokenWei <= c.maxPricePerTokenWei &&
      o.reputation >= c.minReputation,
  );
}

/**
 * Pick the best offer, or null if none qualify. Ties on score break toward the
 * cheaper price, then higher reputation, then lexicographic wallet (fully
 * deterministic — no Math.random).
 */
export function selectBest(offers: readonly NodeOffer[], c: MatchConstraints): ScoredOffer | null {
  const scored = filterEligible(offers, c).map((o) => scoreOffer(o, c));
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.offer.pricePerTokenWei !== b.offer.pricePerTokenWei) {
      return a.offer.pricePerTokenWei < b.offer.pricePerTokenWei ? -1 : 1;
    }
    if (b.offer.reputation !== a.offer.reputation) return b.offer.reputation - a.offer.reputation;
    return a.offer.wallet < b.offer.wallet ? -1 : 1;
  });
  return scored[0] ?? null;
}
