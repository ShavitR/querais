import type { Address } from 'viem';
import type { CreditSession } from './db/sessions.js';

/** Raw inputs for a requester's session-status view (bigints in wei). */
export interface SessionStatusInputs {
  requester: Address;
  settler: Address;
  /** The active (unexpired) session, if any. */
  session: CreditSession | undefined;
  /** On-chain `spentAgainst(requester, session.nonce)`; ignored without a session. */
  spentAgainstWei: bigint;
  /** On-chain `balanceOf(requester)` in the CreditAccount. */
  creditBalanceWei: bigint;
  /** Off-chain debits not yet flushed on-chain. */
  pendingCount: number;
  pendingTotalWei: bigint;
}

/** JSON response for GET /v1/sessions — wei as decimal strings (matches POST). */
export interface SessionStatusResponse {
  requester: Address;
  settler: Address;
  session: {
    nonce: string;
    maxSpendWei: string;
    deadline: string;
    spentAgainstWei: string;
    capRemainingWei: string;
  } | null;
  credit: { balanceWei: string };
  pendingDebits: { count: number; totalWei: string };
  headroomWei: string | null;
}

function floor0(x: bigint): bigint {
  return x < 0n ? 0n : x;
}

/**
 * Derive the requester-facing session status. `headroomWei` mirrors the gateway's
 * `canAccrue` admission math exactly — the largest worst-case job cost the gateway
 * would still accept: min(cap − spent − pending, balance − pending), floored at 0.
 * Pure so it unit-tests without a chain.
 */
export function buildSessionStatus(input: SessionStatusInputs): SessionStatusResponse {
  const { session } = input;
  const pending = {
    count: input.pendingCount,
    totalWei: input.pendingTotalWei.toString(),
  };
  if (!session) {
    return {
      requester: input.requester,
      settler: input.settler,
      session: null,
      credit: { balanceWei: input.creditBalanceWei.toString() },
      pendingDebits: pending,
      headroomWei: null,
    };
  }
  const capRemaining = floor0(session.maxSpendWei - input.spentAgainstWei);
  const headroom = floor0(
    bmin(
      session.maxSpendWei - input.spentAgainstWei - input.pendingTotalWei,
      input.creditBalanceWei - input.pendingTotalWei,
    ),
  );
  return {
    requester: input.requester,
    settler: input.settler,
    session: {
      nonce: session.nonce.toString(),
      maxSpendWei: session.maxSpendWei.toString(),
      deadline: session.deadline.toString(),
      spentAgainstWei: input.spentAgainstWei.toString(),
      capRemainingWei: capRemaining.toString(),
    },
    credit: { balanceWei: input.creditBalanceWei.toString() },
    pendingDebits: pending,
    headroomWei: headroom.toString(),
  };
}

function bmin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
