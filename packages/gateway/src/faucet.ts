import type { Address, Hex } from 'viem';

/** Raised when a faucet claim is refused (already claimed). */
export class FaucetError extends Error {}

/** Minimal dependency the faucet needs to move funds — easy to mock in tests. */
export interface FaucetDistributor {
  transferQais(to: Address, amount: bigint): Promise<Hex>;
  sendEth(to: Address, amount: bigint): Promise<Hex>;
}

export interface FaucetClaim {
  qaisTx: Hex;
  ethTx?: Hex;
}

/**
 * Testnet faucet: dispenses QAIS (stake) and optionally a little ETH (gas) once per
 * address (in-memory Sybil throttle). The ETH drip makes node onboarding zero-touch —
 * a fresh node can self-fund from the gateway and register without any manual steps.
 */
export class Faucet {
  private readonly claimed = new Set<string>();

  constructor(
    private readonly distributor: FaucetDistributor,
    public readonly qaisAmount: bigint,
    public readonly ethAmount: bigint = 0n,
  ) {}

  hasClaimed(address: Address): boolean {
    return this.claimed.has(address.toLowerCase());
  }

  async claim(address: Address): Promise<FaucetClaim> {
    const key = address.toLowerCase();
    if (this.claimed.has(key)) throw new FaucetError('address has already claimed from the faucet');
    this.claimed.add(key); // reserve before the tx to prevent concurrent double-claims
    try {
      const qaisTx = await this.distributor.transferQais(address, this.qaisAmount);
      const claim: FaucetClaim = { qaisTx };
      if (this.ethAmount > 0n)
        claim.ethTx = await this.distributor.sendEth(address, this.ethAmount);
      return claim;
    } catch (err) {
      this.claimed.delete(key); // allow a retry if a transfer failed
      throw err;
    }
  }
}
