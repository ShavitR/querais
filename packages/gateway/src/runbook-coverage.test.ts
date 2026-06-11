import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Slice 8 shipping rule: an alert without a runbook section does not ship.
 * This test scans every production source file for `rule: '<id>'` literals (the
 * Alert.rule field — sweep rules, push rules, and the synthetic test rule) and
 * asserts each id has a `## <id>` heading in docs/RUNBOOK_ALERTS.md, which is
 * where every alert's runbook URL anchor points.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const RUNBOOK_PATH = join(SRC_DIR, '..', '..', '..', 'docs', 'RUNBOOK_ALERTS.md');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function ruleIdsInCode(): Set<string> {
  const ids = new Set<string>();
  for (const file of sourceFiles(SRC_DIR)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/rule: '([a-z0-9-]+)'/g)) {
      ids.add(m[1]!);
    }
  }
  return ids;
}

test('every alert rule id in the code has a runbook section (and vice versa)', () => {
  const ids = ruleIdsInCode();
  // Sanity: the scan actually found the catalogue (guards against a refactor
  // silently changing the literal shape and making this test vacuous).
  assert.ok(ids.size >= 12, `expected >= 12 rule ids, found ${String(ids.size)}`);
  for (const known of ['gas-low', 'layer-a-anomaly', 'keeper-stale', 'test']) {
    assert.ok(ids.has(known), `scan failed to find known rule '${known}'`);
  }

  const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
  const headings = new Set([...runbook.matchAll(/^## ([a-z0-9-]+)$/gm)].map((m) => m[1]!));
  for (const id of ids) {
    assert.ok(
      headings.has(id),
      `alert rule '${id}' has no '## ${id}' section in RUNBOOK_ALERTS.md`,
    );
  }
  // The reverse: a runbook section for a rule that no longer exists is stale docs.
  for (const heading of headings) {
    assert.ok(ids.has(heading), `runbook section '## ${heading}' matches no rule id in the code`);
  }
});
