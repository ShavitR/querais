import type { Address, Hex } from 'viem';
import type { GatewayDb } from './index.js';

/** A requester's active, signed spending cap (mirrors CreditAccount.SpendingCap + sig). */
export interface CreditSession {
  requester: Address;
  settler: Address;
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}

interface SessionRow {
  requester: string;
  settler: string;
  max_spend_wei: string;
  nonce: string;
  deadline: number;
  signature: string;
}

function decode(r: SessionRow): CreditSession {
  return {
    requester: r.requester as Address,
    settler: r.settler as Address,
    maxSpendWei: BigInt(r.max_spend_wei),
    nonce: BigInt(r.nonce),
    deadline: BigInt(r.deadline),
    signature: r.signature as Hex,
  };
}

/**
 * Persists the signed spending cap a requester opened via `POST /v1/sessions`. One active
 * session per requester (a new cap replaces the old). The cap bounds what the gateway can
 * batch-settle; the chain enforces the same bound, so this store is a durable convenience,
 * not a trust anchor.
 */
export class SessionStore {
  constructor(private readonly db: GatewayDb) {}

  /** Insert or replace the active session for a requester. */
  upsert(s: CreditSession): void {
    this.db.conn
      .prepare(
        `INSERT OR REPLACE INTO credit_sessions(
           requester, settler, max_spend_wei, nonce, deadline, signature, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.requester.toLowerCase(),
        s.settler.toLowerCase(),
        s.maxSpendWei.toString(),
        s.nonce.toString(),
        Number(s.deadline),
        s.signature,
        Date.now(),
      );
  }

  /** The requester's active session, or undefined if none / expired (`nowSeconds`). */
  getActive(requester: Address, nowSeconds: number): CreditSession | undefined {
    const row = this.db.conn
      .prepare('SELECT * FROM credit_sessions WHERE requester=?')
      .get(requester.toLowerCase()) as SessionRow | undefined;
    if (!row) return undefined;
    if (row.deadline <= nowSeconds) return undefined;
    return decode(row);
  }
}
