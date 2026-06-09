import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './db/index.js';
import { SessionStore } from './db/sessions.js';
import { DebitLedgerStore } from './db/ledger.js';
import { BatchedSettlement } from './batched-settlement.js';
import type { ChainClient } from './chain-client.js';
import type { SettlementContext } from './settlement.js';

const REQ = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const SETTLER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const PROVIDER = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address;
const TX = ('0x' + 'ab'.repeat(32)) as Hex;
const SIG = ('0x' + 'cd'.repeat(65)) as Hex;

const logger = pino({ level: 'silent' });

function jobId(n: number): Hex {
  return ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex;
}

function ctx(n: number, amountWei = 100n): SettlementContext {
  return {
    jobId: jobId(n),
    provider: PROVIDER,
    requester: REQ,
    authoritativeTokens: 10,
    resultHash: jobId(n),
    paymentWei: amountWei,
  };
}

/** A structural ChainClient fake: every method the batched venue touches, overridable. */
function fakeChain(over: Record<string, unknown> = {}): ChainClient {
  return {
    batchSettle: async () => TX,
    settledJob: async () => false,
    spentAgainst: async () => 0n,
    creditBalance: async () => 1_000_000n,
    getNode: async () => ({ reputationScore: 7000n, stakeAmount: 1_000n }),
    updateReputation: async () => TX,
    slash: async () => TX,
    ...over,
  } as unknown as ChainClient;
}

interface Fixture {
  sessions: SessionStore;
  ledger: DebitLedgerStore;
}

function fixture(deadlineFromNowSeconds = 3600, maxSpendWei = 1_000_000n): Fixture {
  const db = new GatewayDb();
  const sessions = new SessionStore(db);
  const ledger = new DebitLedgerStore(db);
  sessions.upsert({
    requester: REQ,
    settler: SETTLER,
    maxSpendWei,
    nonce: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineFromNowSeconds),
    signature: SIG,
  });
  return { sessions, ledger };
}

test('threshold flush settles pending debits in one batch and stamps the ledger', async () => {
  const { sessions, ledger } = fixture();
  const batches: unknown[][] = [];
  const chain = fakeChain({
    batchSettle: async (_cap: unknown, debits: unknown[]) => {
      batches.push(debits);
      return TX;
    },
  });
  const bs = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: 2,
    deadlineMarginSeconds: 60,
  });

  await bs.settle(ctx(1));
  assert.equal(batches.length, 0, 'below threshold: nothing flushes');
  assert.equal(ledger.pending(REQ).length, 1);

  await bs.settle(ctx(2));
  assert.equal(batches.length, 1, 'threshold reached: exactly one batchSettle');
  assert.equal(batches[0]!.length, 2, 'the one batch covers both debits');
  assert.equal(ledger.pending(REQ).length, 0, 'ledger stamped after flush');
});

test('a debit near the cap deadline flushes immediately (no waiting for the threshold)', async () => {
  const { sessions, ledger } = fixture(30); // cap expires in 30s
  let calls = 0;
  const chain = fakeChain({
    batchSettle: async () => {
      calls += 1;
      return TX;
    },
  });
  const bs = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: 100,
    deadlineMarginSeconds: 60, // 30s remaining < 60s margin → flush now
  });

  await bs.settle(ctx(1));
  assert.equal(calls, 1, 'near-deadline debit triggers an early flush');
  assert.equal(ledger.pending(REQ).length, 0);
});

test('a flush failure never fails settle(); the debit is retained for the next trigger', async () => {
  const { sessions, ledger } = fixture();
  const chain = fakeChain({
    batchSettle: async () => {
      throw new Error('rpc down');
    },
  });
  const bs = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: 1,
    deadlineMarginSeconds: 60,
  });

  await bs.settle(ctx(1)); // must NOT throw — the requester's job succeeded
  assert.equal(ledger.pending(REQ).length, 1, 'debit retained after the failed flush');
});

test('reconcile-on-revert unsticks debits already settled on-chain (crash recovery)', async () => {
  const { sessions, ledger } = fixture();
  // Simulate the crash aftermath: job 1 settled on-chain but is still pending in the ledger.
  ledger.record({
    jobId: jobId(1),
    requester: REQ,
    provider: PROVIDER,
    amountWei: 100n,
    tokens: 10,
  });
  ledger.record({
    jobId: jobId(2),
    requester: REQ,
    provider: PROVIDER,
    amountWei: 200n,
    tokens: 20,
  });

  let attempts = 0;
  const chain = fakeChain({
    batchSettle: async (_cap: unknown, debits: { jobId: Hex }[]) => {
      attempts += 1;
      if (debits.some((d) => d.jobId === jobId(1))) throw new Error('JobAlreadySettled');
      return TX;
    },
    settledJob: async (id: Hex) => id === jobId(1),
  });
  const bs = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: 100,
    deadlineMarginSeconds: 60,
  });

  // First flush reverts, but reconciliation drops the already-settled debit.
  await assert.rejects(bs.flush(REQ), /JobAlreadySettled/);
  const remaining = ledger.pending(REQ);
  assert.equal(remaining.length, 1, 'the already-settled debit was reconciled away');
  assert.equal(remaining[0]!.jobId, jobId(2));

  // The next flush settles the genuinely-unsettled remainder.
  await bs.flush(REQ);
  assert.equal(attempts, 2);
  assert.equal(ledger.pending(REQ).length, 0, 'ledger fully unstuck');
});

test('canAccrue enforces cap and deposit headroom over spent + pending + worst case', async () => {
  const { sessions, ledger } = fixture(3600, 1_000n); // cap = 1000 wei
  const chain = fakeChain({
    spentAgainst: async () => 100n,
    creditBalance: async () => 500n,
  });
  const bs = new BatchedSettlement(chain, sessions, ledger, logger, {
    flushThreshold: 100,
    deadlineMarginSeconds: 60,
  });

  ledger.record({
    jobId: jobId(1),
    requester: REQ,
    provider: PROVIDER,
    amountWei: 100n,
    tokens: 10,
  });

  // spent(100) + pending(100) + worst(200) = 400 ≤ cap; pending + worst = 300 ≤ balance.
  assert.equal(await bs.canAccrue(REQ, 200n), true);
  // Busts the cap: 100 + 100 + 801 = 1001 > 1000.
  assert.equal(await bs.canAccrue(REQ, 801n), false);
  // Fits the cap (650 ≤ 1000) but not the deposited balance: 100 + 450 = 550 > 500.
  assert.equal(await bs.canAccrue(REQ, 450n), false);
});

test('canAccrue is false without an active session', async () => {
  const db = new GatewayDb();
  const bs = new BatchedSettlement(
    fakeChain(),
    new SessionStore(db),
    new DebitLedgerStore(db),
    logger,
    { flushThreshold: 100, deadlineMarginSeconds: 60 },
  );
  assert.equal(await bs.canAccrue(REQ, 1n), false);
});
