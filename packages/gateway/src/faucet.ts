import type { Address, Hex } from 'viem';
import type { GatewayDb } from './db/index.js';
import { HARDENING_DEFAULTS } from './config.js';

/** Raised when a faucet claim is refused (already claimed / throttled / dry). */
export class FaucetError extends Error {}

/** Minimal dependency the faucet needs to move funds — easy to mock in tests.
 *  The balance reads are optional: when present, the faucet refuses (rather than
 *  reverts) once the distributor can no longer fund a claim. */
export interface FaucetDistributor {
  transferQais(to: Address, amount: bigint): Promise<Hex>;
  sendEth(to: Address, amount: bigint): Promise<Hex>;
  qaisBalance?(): Promise<bigint>;
  ethBalance?(): Promise<bigint>;
}

export interface FaucetClaim {
  qaisTx: Hex;
  ethTx?: Hex;
}

export interface FaucetThrottles {
  /** Max claims per source IP per rolling 24h. */
  ipDailyLimit: number;
  /** Max claims network-wide per rolling 24h. */
  dailyCap: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Anti-drain layers (all durable in {@link GatewayDb}, so they survive restarts):
 *  1. one claim per address — an atomic `INSERT` on the address PRIMARY KEY (also closes the
 *     concurrent double-claim race without an in-process lock);
 *  2. per-IP daily throttle — fresh addresses are free to mint, source IPs are not;
 *  3. global daily cap — bounds total drain even from a botnet of IPs;
 *  4. distributor balance guard — refuse cleanly when the well is dry instead of reverting.
 */
export class Faucet {
  private readonly throttles: FaucetThrottles;

  constructor(
    private readonly db: GatewayDb,
    private readonly distributor: FaucetDistributor,
    public readonly qaisAmount: bigint,
    public readonly ethAmount: bigint = 0n,
    throttles?: Partial<FaucetThrottles>,
  ) {
    this.throttles = {
      ipDailyLimit: throttles?.ipDailyLimit ?? HARDENING_DEFAULTS.faucetIpDailyLimit,
      dailyCap: throttles?.dailyCap ?? HARDENING_DEFAULTS.faucetDailyCap,
    };
  }

  hasClaimed(address: Address): boolean {
    return (
      this.db.conn
        .prepare('SELECT 1 FROM faucet_claims WHERE address = ?')
        .get(address.toLowerCase()) !== undefined
    );
  }

  private countSince(sql: string, ...params: (string | number)[]): number {
    const row = this.db.conn.prepare(sql).get(...params) as { n: number };
    return row.n;
  }

  async claim(address: Address, ip?: string): Promise<FaucetClaim> {
    const key = address.toLowerCase();
    const dayAgo = Date.now() - DAY_MS;

    // Throttles first (cheap, durable). These are rate caps, not money invariants — the
    // money invariant (one dispense per address) stays the atomic INSERT below.
    const today = this.countSince(
      'SELECT COUNT(*) AS n FROM faucet_claims WHERE claimed_at > ?',
      dayAgo,
    );
    if (today >= this.throttles.dailyCap) {
      throw new FaucetError('faucet daily cap reached — try again tomorrow');
    }
    if (ip) {
      const fromIp = this.countSince(
        'SELECT COUNT(*) AS n FROM faucet_claims WHERE ip = ? AND claimed_at > ?',
        ip,
        dayAgo,
      );
      if (fromIp >= this.throttles.ipDailyLimit) {
        throw new FaucetError('too many faucet claims from this address today');
      }
    }

    // Balance guard: refuse before reserving when the distributor can't fund the claim.
    if (this.distributor.qaisBalance && (await this.distributor.qaisBalance()) < this.qaisAmount) {
      throw new FaucetError('faucet is out of QAIS — try again later');
    }
    if (
      this.ethAmount > 0n &&
      this.distributor.ethBalance &&
      (await this.distributor.ethBalance()) < this.ethAmount
    ) {
      throw new FaucetError('faucet is out of gas ETH — try again later');
    }

    // Reserve atomically before the transfer: a duplicate INSERT fails the PRIMARY KEY, so two
    // concurrent claims (or a restart-and-retry) can't both dispense.
    try {
      this.db.conn
        .prepare('INSERT INTO faucet_claims(address, ip, claimed_at) VALUES(?, ?, ?)')
        .run(key, ip ?? null, Date.now());
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
