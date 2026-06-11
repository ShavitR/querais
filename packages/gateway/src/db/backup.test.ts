import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyFileSync, rmSync } from 'node:fs';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './index.js';
import { JobStore } from './jobs.js';

const REQUESTER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;
const PROVIDER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;

function tmp(suffix: string): string {
  return join(tmpdir(), `querais-backup-${process.pid}-${Date.now()}-${suffix}`);
}
function cleanup(path: string): void {
  for (const s of ['', '-wal', '-shm']) rmSync(`${path}${s}`, { force: true });
}

/**
 * The Slice 7A restore drill, as an automated test: settled state committed before a
 * backup survives a "crash + restore"; work done AFTER the backup is the RPO window
 * (lost on restore, and — in production — caught by the 2C reconcile-on-revert machinery
 * when the next flush hits an already-settled job). This pins the backup/restore path
 * the runbook §9 procedure depends on.
 */
test('VACUUM INTO snapshot restores committed state after a crash', () => {
  const live = tmp('live.db');
  const snapshot = tmp('snap.db');
  try {
    const before = new GatewayDb(live);
    const jobsBefore = new JobStore(before);
    const settled = ('0x' + '11'.repeat(32)) as Hex;
    jobsBefore.recordAssigned({
      jobId: settled,
      requester: REQUESTER,
      provider: PROVIDER,
      model: 'mock-model',
      maxTokens: 100,
      agreedPriceWei: 1000n,
      lockedWei: 100_000n,
    });
    jobsBefore.markSettled(settled, {
      actualTokens: 40,
      paymentWei: 40_000n,
      providerPayWei: 38_000n,
      feeWei: 2_000n,
    });

    // Continuous backup checkpoint.
    before.backupTo(snapshot);

    // Post-backup work — the RPO window that a restore will lose.
    const afterBackup = ('0x' + '22'.repeat(32)) as Hex;
    jobsBefore.recordAssigned({
      jobId: afterBackup,
      requester: REQUESTER,
      provider: PROVIDER,
      model: 'mock-model',
      maxTokens: 50,
      agreedPriceWei: 1000n,
      lockedWei: 50_000n,
    });
    before.close();

    // Crash + restore: the snapshot replaces the live file.
    cleanup(live);
    copyFileSync(snapshot, live);

    const restored = new GatewayDb(live);
    const jobsRestored = new JobStore(restored);
    // Settled state (pre-backup) is intact — no provider goes unpaid on the books.
    const recovered = jobsRestored.get(settled);
    assert.equal(recovered?.status, 'verified');
    assert.equal(recovered?.providerPayWei, '38000');
    assert.deepEqual(jobsRestored.usageFor(REQUESTER), {
      jobs: 1,
      tokens: 40,
      spentWei: '40000',
    });
    // The RPO-window job is gone — expected; the live ledger's reconcile path handles it.
    assert.equal(jobsRestored.get(afterBackup), undefined);
    restored.close();
  } finally {
    cleanup(live);
    cleanup(snapshot);
  }
});

test('backupTo refuses to overwrite an existing snapshot (no silent clobber)', () => {
  const live = tmp('live2.db');
  const snapshot = tmp('snap2.db');
  try {
    const db = new GatewayDb(live);
    db.backupTo(snapshot);
    assert.throws(() => db.backupTo(snapshot), /exists|VACUUM|output/i);
    db.close();
  } finally {
    cleanup(live);
    cleanup(snapshot);
  }
});
