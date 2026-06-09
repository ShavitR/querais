import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { DebitLedgerStore, type DebitEntry } from './ledger.js';

const REQ_A = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const REQ_B = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address;
const PROVIDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;

function debit(n: number, over: Partial<DebitEntry> = {}): DebitEntry {
  return {
    jobId: ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex,
    requester: REQ_A,
    provider: PROVIDER,
    amountWei: 1_000n,
    tokens: 10,
    ...over,
  };
}

test('records pending debits and flushes them by batch id', () => {
  const ledger = new DebitLedgerStore(new GatewayDb());
  ledger.record(debit(1));
  ledger.record(debit(2));
  ledger.record(debit(3, { requester: REQ_B }));

  // Pending is per-requester and excludes other requesters.
  assert.equal(ledger.pending(REQ_A).length, 2);
  assert.equal(ledger.pending(REQ_B).length, 1);
  assert.deepEqual(
    ledger.requestersWithPending().sort(),
    [REQ_B.toLowerCase(), REQ_A.toLowerCase()].sort(),
  );

  // Flushing REQ_A's two debits stamps them and clears them from pending.
  const batch = ('0x' + 'ab'.repeat(32)) as Hex;
  ledger.markBatched([debit(1).jobId, debit(2).jobId], batch);
  assert.equal(ledger.pending(REQ_A).length, 0);
  assert.equal(ledger.pending(REQ_B).length, 1); // untouched
  assert.deepEqual(ledger.requestersWithPending(), [REQ_B.toLowerCase()]);
});

test('a retried jobId overwrites rather than duplicating', () => {
  const ledger = new DebitLedgerStore(new GatewayDb());
  ledger.record(debit(1, { amountWei: 1_000n }));
  ledger.record(debit(1, { amountWei: 2_000n }));
  const pending = ledger.pending(REQ_A);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.amountWei, 2_000n);
});

test('pending debits survive a restart', () => {
  const path = join(tmpdir(), `querais-ledger-${process.pid}-${Date.now()}.db`);
  try {
    const first = new GatewayDb(path);
    new DebitLedgerStore(first).record(debit(7, { amountWei: 4_200n }));
    first.close();

    const second = new GatewayDb(path);
    const pending = new DebitLedgerStore(second).pending(REQ_A);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.amountWei, 4_200n);
    second.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  }
});
