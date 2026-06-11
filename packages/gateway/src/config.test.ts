import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS_DEFAULTS, loadConfig, resolveAlerts } from './config.js';

const KEY = '0x' + 'aa'.repeat(32);

/** The minimum env loadConfig accepts (everything else has defaults). */
function baseEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { GATEWAY_PRIVATE_KEY: KEY, ...extra };
}

test('resolveAlerts: defaults stand alone, partial overrides win', () => {
  const d = resolveAlerts();
  assert.equal(d.webhookUrl, undefined, 'alerting off by default');
  assert.equal(d.webhookFormat, 'generic');
  assert.equal(d.minSeverity, 'warn');
  assert.equal(d.cooldownSeconds, 3600);
  assert.equal(d.sweepIntervalSeconds, 60);
  assert.equal(d.gasMinWei, 10n ** 16n);
  assert.equal(d.debitMaxAgeSeconds, 900);
  assert.equal(d.settleFailStreak, 3);

  const r = resolveAlerts({ cooldownSeconds: 1, minSeverity: 'info' });
  assert.equal(r.cooldownSeconds, 1);
  assert.equal(r.minSeverity, 'info');
  assert.equal(r.gasMinWei, ALERTS_DEFAULTS.gasMinWei, 'untouched fields keep defaults');
});

test('loadConfig with zero GATEWAY_ALERT_* vars leaves the alerts group empty', () => {
  const cfg = loadConfig(baseEnv());
  assert.deepEqual(cfg.alerts, {}, 'no env → no overrides → defaults at resolve time');
});

test('loadConfig parses every GATEWAY_ALERT_* override', () => {
  const cfg = loadConfig(
    baseEnv({
      GATEWAY_ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x',
      GATEWAY_ALERT_WEBHOOK_FORMAT: 'discord',
      GATEWAY_ALERT_MIN_SEVERITY: 'info',
      GATEWAY_ALERT_COOLDOWN_SECONDS: '5',
      GATEWAY_ALERT_SWEEP_INTERVAL_SECONDS: '2',
      GATEWAY_ALERT_GAS_MIN_WEI: '20000000000000000',
      GATEWAY_ALERT_DEBIT_MAX_AGE_SECONDS: '30',
      GATEWAY_ALERT_SETTLE_FAIL_STREAK: '5',
    }),
  );
  const a = resolveAlerts(cfg.alerts);
  assert.equal(a.webhookUrl, 'https://discord.com/api/webhooks/1/x');
  assert.equal(a.webhookFormat, 'discord');
  assert.equal(a.minSeverity, 'info');
  assert.equal(a.cooldownSeconds, 5);
  assert.equal(a.sweepIntervalSeconds, 2);
  assert.equal(a.gasMinWei, 2n * 10n ** 16n);
  assert.equal(a.debitMaxAgeSeconds, 30);
  assert.equal(a.settleFailStreak, 5);
});

test('loadConfig rejects unknown webhook format / severity (fail fast at boot)', () => {
  assert.throws(
    () => loadConfig(baseEnv({ GATEWAY_ALERT_WEBHOOK_FORMAT: 'telegram' })),
    /discord\|slack\|generic/,
  );
  assert.throws(
    () => loadConfig(baseEnv({ GATEWAY_ALERT_MIN_SEVERITY: 'fatal' })),
    /info\|warn\|critical/,
  );
});
