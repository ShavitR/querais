/**
 * Auto-pricing for a node operator (from querais_node_design.md §5). Pure integer
 * (wei) math so it composes with on-chain amounts.
 *
 *   base   = market_median × 0.90        (10% under median to win bids)
 *   × load multiplier  (<20%:0.85, 20–60%:1.00, 60–80%:1.10, >80%:1.25)
 *   × reputation adj   (>0.95:1.05, <0.80:0.90, else 1.00)
 *   then clamped to [electricity_floor, 2 × market_median]
 *     where electricity_floor = electricity_cost_per_token × 1.20
 *
 * Until a real market feed exists, callers pass their configured base price as the
 * `marketMedianWei` (a single node's best estimate of the market).
 */
export interface AutoPriceInputs {
  /** Node's view of the market median price per token (wei). */
  marketMedianWei: bigint;
  /** Current utilization, 0..1. */
  loadFraction: number;
  /** Node reputation in basis points (0..10000). */
  reputationBps: number;
  /** Node's electricity cost per token (wei); sets a hard floor. */
  electricityCostPerTokenWei: bigint;
}

const BPS = 10000n;
function scale(value: bigint, bps: bigint): bigint {
  return (value * bps) / BPS;
}

function loadMultiplierBps(loadFraction: number): bigint {
  const load = Math.min(1, Math.max(0, loadFraction));
  if (load < 0.2) return 8500n; // discount to attract jobs
  if (load < 0.6) return 10000n; // market price
  if (load < 0.8) return 11000n; // slight premium
  return 12500n; // scarcity premium
}

function reputationMultiplierBps(reputationBps: number): bigint {
  if (reputationBps > 9500) return 10500n; // premium for trusted node
  if (reputationBps < 8000) return 9000n; // discount to compete
  return 10000n;
}

export function computeAutoPrice(i: AutoPriceInputs): bigint {
  if (i.marketMedianWei <= 0n) return i.electricityCostPerTokenWei; // degenerate fallback

  let price = scale(i.marketMedianWei, 9000n); // base = median × 0.90
  price = scale(price, loadMultiplierBps(i.loadFraction));
  price = scale(price, reputationMultiplierBps(i.reputationBps));

  // Hard electricity floor (cost × 1.20) and a ceiling at 2× the market median.
  const floor = scale(i.electricityCostPerTokenWei, 12000n);
  if (price < floor) price = floor;
  const ceiling = i.marketMedianWei * 2n;
  if (price > ceiling) price = ceiling;

  return price;
}
