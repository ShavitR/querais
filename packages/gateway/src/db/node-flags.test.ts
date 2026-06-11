import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Address } from 'viem';
import { GatewayDb } from './index.js';
import { NodeFlagStore } from './node-flags.js';

const NODE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const OTHER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

function tmpDbPath(): string {
  return join(
    tmpdir(),
    `querais-flags-${process.pid}-${Date.now()}-${Math.floor(performance.now())}.db`,
  );
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
}

test('flags open by default; markReviewed closes exactly once (404/409 surface)', () => {
  const db = new GatewayDb();
  const flags = new NodeFlagStore(db);
  flags.add(NODE, 'layer-a:anomaly', 'job 0xaa similarity 0.41 < 0.70');
  flags.add(OTHER, 'pattern:truncation', 'every recent job truncated at length');

  assert.equal(flags.openCount(), 2);
  assert.equal(flags.openCountFor(NODE), 1);
  const open = flags.list();
  assert.equal(open.length, 2);
  assert.equal(open[0]?.reviewedAt, null, 'fresh flags are open');

  const id = flags.forWallet(NODE)[0]!.id;
  const ok = flags.markReviewed(id, 'shavit', 'false positive — known prompt');
  assert.equal(ok.outcome, 'ok');
  if (ok.outcome === 'ok') {
    assert.equal(ok.flag.reviewedBy, 'shavit');
    assert.equal(ok.flag.reviewNote, 'false positive — known prompt');
    assert.ok(ok.flag.reviewedAt !== null);
  }
  assert.equal(flags.openCount(), 1);
  assert.equal(flags.openCountFor(NODE), 0, 'reviewed flags stop counting against the node');
  assert.equal(flags.countFor(NODE), 1, 'history is preserved');

  assert.equal(flags.markReviewed(id, 'again').outcome, 'already-reviewed');
  assert.equal(flags.markReviewed(99_999, 'nobody').outcome, 'not-found');
});

test('list filters by status + wallet and paginates newest-first', () => {
  const db = new GatewayDb();
  const flags = new NodeFlagStore(db);
  for (let i = 0; i < 3; i++) flags.add(NODE, 'layer-a:anomaly', `flag ${String(i)}`);
  flags.add(OTHER, 'pattern:duplicate-output', 'other node');
  const reviewedId = flags.forWallet(NODE)[0]!.id;
  flags.markReviewed(reviewedId, 'shavit');

  assert.equal(flags.list().length, 3, 'default = open only');
  assert.equal(flags.list({ status: 'all' }).length, 4, 'all includes the reviewed one');
  assert.equal(flags.list({ wallet: NODE }).length, 2);
  assert.equal(flags.list({ status: 'all', wallet: NODE }).length, 3);

  const page = flags.list({ status: 'all', limit: 2, offset: 0 });
  assert.equal(page.length, 2);
  const rest = flags.list({ status: 'all', limit: 2, offset: 2 });
  assert.equal(rest.length, 2);
  const ids = new Set([...page, ...rest].map((f) => f.id));
  assert.equal(ids.size, 4, 'pagination covers every flag exactly once');
  assert.ok(page[0]!.id > rest[1]!.id, 'newest first');
});

test('get round-trips a single flag', () => {
  const db = new GatewayDb();
  const flags = new NodeFlagStore(db);
  flags.add(NODE, 'pattern:duplicate-output', 'identical output for 3 hashes');
  const id = flags.forWallet(NODE)[0]!.id;
  const flag = flags.get(id);
  assert.equal(flag?.kind, 'pattern:duplicate-output');
  assert.equal(flag?.wallet, NODE.toLowerCase());
  assert.equal(flags.get(12345), undefined);
});

test('migration 7 upgrades a populated pre-Slice-8 DB; existing flags become open', () => {
  const path = tmpDbPath();
  try {
    // Hand-build the migration-6 shape of node_flags with a live row, exactly as a
    // production volume would look the moment the Slice-8 image boots on it.
    const raw = new DatabaseSync(path);
    raw.exec(`CREATE TABLE node_flags (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       wallet     TEXT NOT NULL,
       kind       TEXT NOT NULL,
       detail     TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
     CREATE INDEX idx_node_flags_wallet ON node_flags(wallet, created_at);`);
    raw
      .prepare(`INSERT INTO node_flags(wallet, kind, detail, created_at) VALUES(?, ?, ?, ?)`)
      .run(NODE.toLowerCase(), 'layer-a:anomaly', 'pre-upgrade flag', Date.now());
    raw.exec('PRAGMA user_version = 6'); // pretend migrations 1-6 ran
    raw.close();

    // Boot: migration 7 must apply additively without touching the row.
    const db = new GatewayDb(path);
    const flags = new NodeFlagStore(db);
    assert.equal(flags.openCount(), 1, 'the pre-existing flag surfaces as open');
    const flag = flags.list()[0]!;
    assert.equal(flag.detail, 'pre-upgrade flag');
    assert.equal(flag.reviewedAt, null);
    const reviewed = flags.markReviewed(flag.id, 'shavit', 'post-upgrade review');
    assert.equal(reviewed.outcome, 'ok');
    assert.equal(flags.openCount(), 0);
    db.close();
  } finally {
    cleanup(path);
  }
});
