import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { metrics } from './metrics.js';
import {
  AlertService,
  MemorySink,
  NoopSink,
  WebhookSink,
  redactWebhookUrl,
  runbookUrl,
  type Alert,
  type AlertInput,
} from './alerts.js';

const logger = pino({ level: 'silent' });

function input(over?: Partial<AlertInput>): AlertInput {
  return {
    key: 'gas-low',
    rule: 'gas-low',
    severity: 'critical',
    title: 'Hot wallet gas low',
    detail: 'balance 0.004 ETH < 0.01 ETH',
    ...over,
  };
}

/** raise() hands the sink a floating promise — let it settle. */
const tick = () => new Promise((r) => setImmediate(r));

// ── AlertService ──────────────────────────────────────────────────────────────────

test('raise delivers through the sink with runbook URL + timestamp stamped', async () => {
  const sink = new MemorySink();
  const svc = new AlertService(sink, logger, { cooldownSeconds: 3600, minSeverity: 'warn' });
  const before = Date.now();
  svc.raise(input());
  await tick();
  assert.equal(sink.alerts.length, 1);
  const a = sink.alerts[0]!;
  assert.equal(a.rule, 'gas-low');
  assert.equal(a.runbook, runbookUrl('gas-low'));
  assert.ok(a.runbook.endsWith('RUNBOOK_ALERTS.md#gas-low'));
  assert.ok(a.at >= before && a.at <= Date.now());
});

test('cooldown: identical key suppressed, different key delivers, counted as suppressed', async () => {
  const sink = new MemorySink();
  const svc = new AlertService(sink, logger, { cooldownSeconds: 3600, minSeverity: 'warn' });
  const suppressedBefore = metrics.alertsSuppressed;
  svc.raise(input());
  svc.raise(input()); // same key, inside cooldown → suppressed
  svc.raise(input({ key: 'gas-low:other' })); // different key → delivers
  await tick();
  assert.equal(sink.alerts.length, 2);
  assert.equal(metrics.alertsSuppressed, suppressedBefore + 1);
});

test('cooldown expiry re-raises', async () => {
  const sink = new MemorySink();
  const svc = new AlertService(sink, logger, { cooldownSeconds: 0, minSeverity: 'warn' });
  svc.raise(input());
  svc.raise(input());
  await tick();
  assert.equal(sink.alerts.length, 2, 'zero cooldown means every raise delivers');
});

test('severity floor: info dropped at warn floor, everything delivers at info floor', async () => {
  const sink = new MemorySink();
  const svc = new AlertService(sink, logger, { cooldownSeconds: 0, minSeverity: 'warn' });
  svc.raise(input({ severity: 'info', key: 'a' }));
  svc.raise(input({ severity: 'warn', key: 'b' }));
  svc.raise(input({ severity: 'critical', key: 'c' }));
  await tick();
  assert.deepEqual(
    sink.alerts.map((a) => a.severity),
    ['warn', 'critical'],
  );

  const open = new MemorySink();
  const chatty = new AlertService(open, logger, { cooldownSeconds: 0, minSeverity: 'info' });
  chatty.raise(input({ severity: 'info', key: 'a' }));
  await tick();
  assert.equal(open.alerts.length, 1, 'info floor opts in to info alerts');
});

test('delivery failure is counted and never thrown; cooldown still consumed', async () => {
  const sink = new MemorySink();
  sink.failWith = new Error('webhook down');
  const svc = new AlertService(sink, logger, { cooldownSeconds: 3600, minSeverity: 'warn' });
  const failedBefore = metrics.alertsFailed;
  svc.raise(input()); // must not throw
  await tick();
  assert.equal(metrics.alertsFailed, failedBefore + 1);
  // The failed attempt consumed the cooldown — an immediate re-raise is suppressed
  // (no-retry-queue trade-off: storms can't pile up behind a dead webhook).
  const suppressedBefore = metrics.alertsSuppressed;
  svc.raise(input());
  await tick();
  assert.equal(metrics.alertsSuppressed, suppressedBefore + 1);
});

test('metrics: raised counted per severity', async () => {
  const sink = new MemorySink();
  const svc = new AlertService(sink, logger, { cooldownSeconds: 0, minSeverity: 'info' });
  const raisedBefore = metrics.alertsRaised;
  const warnBefore = metrics.alertsRaisedBySeverity.warn;
  const deliveredBefore = metrics.alertsDelivered;
  svc.raise(input({ severity: 'warn', key: 'w' }));
  svc.raise(input({ severity: 'critical', key: 'c' }));
  await tick();
  assert.equal(metrics.alertsRaised, raisedBefore + 2);
  assert.equal(metrics.alertsRaisedBySeverity.warn, warnBefore + 1);
  assert.equal(metrics.alertsDelivered, deliveredBefore + 2);
});

test('deliverTest bypasses floor + cooldown and reports the outcome', async () => {
  const sink = new MemorySink();
  // Floor 'critical' would normally drop an info alert; deliverTest must not.
  const svc = new AlertService(sink, logger, { cooldownSeconds: 3600, minSeverity: 'critical' });
  const ok = await svc.deliverTest();
  assert.deepEqual(ok, { delivered: true });
  assert.equal(sink.alerts[0]?.rule, 'test');

  sink.failWith = new Error('channel rejected');
  const bad = await svc.deliverTest();
  assert.equal(bad.delivered, false);
  assert.match(bad.error ?? '', /channel rejected/);
});

test('NoopSink swallows everything (gateway runs fine with alerting off)', async () => {
  const svc = new AlertService(new NoopSink(), logger, { cooldownSeconds: 0, minSeverity: 'warn' });
  svc.raise(input());
  await tick(); // nothing to assert beyond "did not throw"
});

// ── WebhookSink formats ───────────────────────────────────────────────────────────

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function sample(): Alert {
  return {
    key: 'gas-low',
    rule: 'gas-low',
    severity: 'critical',
    title: 'Hot wallet gas low',
    detail: 'balance 0.004 ETH',
    runbook: runbookUrl('gas-low'),
    at: 1700000000000,
  };
}

test('discord format posts {content} with title, detail, and runbook link', async () => {
  const { fn, calls } = fakeFetch();
  await new WebhookSink('https://discord.com/api/webhooks/123/secret', 'discord', fn).deliver(
    sample(),
  );
  const body = calls[0]!.body as { content: string };
  assert.match(body.content, /Hot wallet gas low/);
  assert.match(body.content, /balance 0\.004 ETH/);
  assert.match(body.content, /RUNBOOK_ALERTS\.md#gas-low/);
  assert.match(body.content, /🔴/);
});

test('slack format posts {text}; generic posts the raw Alert JSON', async () => {
  const slack = fakeFetch();
  await new WebhookSink('https://hooks.slack.com/services/x', 'slack', slack.fn).deliver(sample());
  assert.match((slack.calls[0]!.body as { text: string }).text, /Hot wallet gas low/);

  const generic = fakeFetch();
  await new WebhookSink('https://example.com/hook', 'generic', generic.fn).deliver(sample());
  assert.deepEqual(generic.calls[0]!.body, JSON.parse(JSON.stringify(sample())));
});

test('non-2xx response throws with the host only — never the full URL', async () => {
  const { fn } = fakeFetch(500);
  const sink = new WebhookSink('https://discord.com/api/webhooks/123/tokensecret', 'discord', fn);
  await assert.rejects(
    () => sink.deliver(sample()),
    (err: Error) => {
      assert.match(err.message, /HTTP 500/);
      assert.match(err.message, /discord\.com/);
      assert.ok(!err.message.includes('tokensecret'), 'webhook token must not leak');
      return true;
    },
  );
});

test('redactWebhookUrl: host only, tolerant of garbage', () => {
  assert.equal(redactWebhookUrl('https://discord.com/api/webhooks/1/abc'), 'discord.com');
  assert.equal(redactWebhookUrl('not a url'), '<invalid url>');
});
