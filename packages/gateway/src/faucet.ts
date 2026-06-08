import type { Address, Hex } from 'viem';

/** Raised when a faucet claim is refused (already claimed). */
export class FaucetError extends Error {}

/** Minimal dependency the faucet needs to move QAIS — easy to mock in tests. */
export interface QaisDistributor {
  transfer(to: Address, amount: bigint): Promise<Hex>;
}

/**
 * Testnet QAIS faucet: dispenses a fixed amount once per address (in-memory Sybil
 * throttle; the gateway's global rate limiter throttles request volume). Decoupled
 * from viem via QaisDistributor so the claim logic is testable without a chain.
 */
export class Faucet {
  private readonly claimed = new Set<string>();

  constructor(
    private readonly distributor: QaisDistributor,
    public readonly amount: bigint,
  ) {}

  hasClaimed(address: Address): boolean {
    return this.claimed.has(address.toLowerCase());
  }

  async claim(address: Address): Promise<Hex> {
    const key = address.toLowerCase();
    if (this.claimed.has(key)) throw new FaucetError('address has already claimed from the faucet');
    this.claimed.add(key); // reserve before the tx to prevent concurrent double-claims
    try {
      return await this.distributor.transfer(address, this.amount);
    } catch (err) {
      this.claimed.delete(key); // allow a retry if the transfer itself failed
      throw err;
    }
  }
}
