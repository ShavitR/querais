import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, type Address, type Hex } from 'viem';
import { buildSessionStatus, type SessionStatusInputs } from './session-status.js';
import type { CreditSession } from './db/sessions.js';

const REQUESTER = '0x90f79bf6eb2c4f870365e785982e1f101e93b906' as Address;
const SETTLER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' as Address;

function session(overrides: Partial<CreditSession> = {}): CreditSession {
  return {
    requester: REQUESTER,
    settler: SETTLER,
    maxSpendWei: parseEther('100'),
    nonce: 1n,
    deadline: 4_000_000_000n,
    signature: '0xsig' as Hex,
    ...overrides,
  };
}

function inputs(overrides: Partial<SessionStatusInputs> = {}): SessionStatusInputs {
  return {
    requester: REQUESTER,
    settler: SETTLER,
    session: session(),
    spentAgainstWei: 0n,
    creditBalanceWei: parseEther('500'),
    pendingCount: 0,
    pendingTotalWei: 0n,
    ...overrides,
  };
}

describe('buildSessionStatus', () => {
  it('no session → null session/headroom, credit + pending still reported', () => {
    const out = buildSessionStatus(
      inputs({ session: undefined, pendingCount: 2, pendingTotalWei: parseEther('3') }),
    );
    assert.equal(out.session, null);
    assert.equal(out.headroomWei, null);
    assert.equal(out.credit.balanceWei, parseEther('500').toString());
    // Pending debits stay visible without a session — that's the stuck-state signal.
    assert.deepEqual(out.pendingDebits, { count: 2, totalWei: parseEther('3').toString() });
  });

  it('fresh session, zero spent/pending → capRemaining == cap, headroom cap-bound', () => {
    const out = buildSessionStatus(inputs());
    assert.equal(out.session?.capRemainingWei, parseEther('100').toString());
    assert.equal(out.session?.spentAgainstWei, '0');
    // balance (500) > cap (100), so the cap binds.
    assert.equal(out.headroomWei, parseEther('100').toString());
  });

  it('pending debits reduce headroom but not capRemaining', () => {
    const out = buildSessionStatus(inputs({ pendingCount: 4, pendingTotalWei: parseEther('30') }));
    assert.equal(out.session?.capRemainingWei, parseEther('100').toString());
    assert.equal(out.headroomWei, parseEther('70').toString()); // 100 − 0 − 30
  });

  it('spent near the cap floors capRemaining and headroom at 0', () => {
    const out = buildSessionStatus(
      inputs({
        spentAgainstWei: parseEther('99'),
        pendingTotalWei: parseEther('5'),
        pendingCount: 1,
      }),
    );
    assert.equal(out.session?.capRemainingWei, parseEther('1').toString());
    assert.equal(out.headroomWei, '0'); // 100 − 99 − 5 < 0 → floored
  });

  it('a small deposit binds headroom below the cap (canAccrue parity)', () => {
    const out = buildSessionStatus(
      inputs({
        creditBalanceWei: parseEther('10'),
        pendingTotalWei: parseEther('4'),
        pendingCount: 2,
      }),
    );
    // min(cap − spent − pending, balance − pending) = min(96, 6) = 6.
    assert.equal(out.headroomWei, parseEther('6').toString());
  });

  it('round-trips bigints as decimal strings (wei, no precision loss)', () => {
    const big = 123_456_789_012_345_678_901_234_567_890n;
    const out = buildSessionStatus(
      inputs({ session: session({ maxSpendWei: big * 2n }), creditBalanceWei: big }),
    );
    assert.equal(out.credit.balanceWei, big.toString());
    assert.equal(out.session?.maxSpendWei, (big * 2n).toString());
    assert.equal(out.headroomWei, big.toString()); // balance binds
  });
});
