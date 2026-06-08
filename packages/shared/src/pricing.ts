import { parseEther, formatEther } from 'viem';

/** Protocol fee in basis points (5%). Mirrors JobEscrow.protocolFeeRate default. */
export const FEE_BPS = 500;
export const BPS_DENOMINATOR = 10000n;

/** Convert a QAIS amount (decimal string or number) to wei. */
export function qaisToWei(qais: number | string): bigint {
  return parseEther(typeof qais === 'number' ? qais.toString() : qais);
}

/** Human-readable QAIS string from wei. */
export function weiToQais(wei: bigint): string {
  return formatEther(wei);
}

/**
 * Convert a "QAIS per 1,000 tokens" price (the developer-facing unit in the
 * OpenAI-compatible request) into integer wei-per-token. Done ONCE at job
 * creation so the chain never sees a float.
 */
export function per1kQaisToWeiPerToken(qaisPer1k: number | string): bigint {
  return qaisToWei(qaisPer1k) / 1000n;
}

/** Amount locked in escrow for a job: maxPricePerToken * maxTokens (integer wei). */
export function lockAmount(maxPricePerTokenWei: bigint, maxTokens: number | bigint): bigint {
  return maxPricePerTokenWei * BigInt(maxTokens);
}

/** Actual payment owed: agreedPricePerToken * actualTokens (integer wei). */
export function paymentFor(agreedPricePerTokenWei: bigint, actualTokens: number | bigint): bigint {
  return agreedPricePerTokenWei * BigInt(actualTokens);
}

/**
 * Split a payment into provider and protocol shares using basis-point integer
 * math — identical to JobEscrow.verifyAndRelease so off-chain estimates match
 * on-chain settlement exactly.
 */
export function splitPayment(
  actualPayment: bigint,
  feeBps: number = FEE_BPS,
): { providerPay: bigint; fee: bigint } {
  const fee = (actualPayment * BigInt(feeBps)) / BPS_DENOMINATOR;
  return { fee, providerPay: actualPayment - fee };
}
