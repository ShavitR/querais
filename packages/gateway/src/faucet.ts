import type { Address, Hex } from 'viem';
import type { GatewayDb } from './db/index.js';

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

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/.test(err.message)
  );
}

/**
 * Testnet faucet: dispenses QAIS (stake) and optionally a little ETH (gas) once per address.
 * The ETH drip makes node onboarding zero-touch — a fresh node can self-fund from the gateway
 * and register without any manual steps.
 *
 * Claims are persisted in {@link GatewayDb}, so the one-per-address Sybil throttle survives a
 * restart (the previous in-memory `Set` reset on every restart — an actor could re-claim by
 * bouncing the process). The reserve is an atomic `INSERT` on the address PRIMARY KEY, which
 * also closes the concurrent double-claim race without an in-process lock.
 */
export class Faucet {
  constructor(
    private readonly db: GatewayDb,
    private readonly distributor: FaucetDistributor,
    public readonly qaisAmount: bigint,
    public readonly ethAmount: bigint = 0n,
  ) {}

  hasClaimed(address: Address): boolean {
    return (
      this.db.conn
        .prepare('SELECT 1 FROM faucet_claims WHERE address = ?')
        .get(address.toLowerCase()) !== undefined
    );
  }

  async claim(address: Address): Promise<FaucetClaim> {
    const key = address.toLowerCase();
    // Reserve atomically before the transfer: a duplicate INSERT fails the PRIMARY KEY, so two
    // concurrent claims (or a restart-and-retry) can't both dispense.
    try {
      this.db.conn
        .prepare('INSERT INTO faucet_claims(address, claimed_at) VALUES(?, ?)')
        .run(key, Date.now());
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new FaucetError('address has already claimed from the faucet');
      }
      throw err;
    }

    try {
      const qaisTx = await this.distributor.transferQais(address, this.qaisAmount);
      let ethTx: Hex | undefined;
      if (this.ethAmount > 0n) ethTx = await this.distributor.sendEth(address, this.ethAmount);
      this.db.conn
        .prepare('UPDATE faucet_claims SET qais_tx = ?, eth_tx = ? WHERE address = ?')
        .run(qaisTx, ethTx ?? null, key);
      const claim: FaucetClaim = { qaisTx };
      if (ethTx) claim.ethTx = ethTx;
      return claim;
    } catch (err) {
      // Release the reservation so a failed transfer can be retried.
      this.db.conn.prepare('DELETE FROM faucet_claims WHERE address = ?').run(key);
      throw err;
    }
  }
}
