import type { Logger } from 'pino';
import { metrics } from './metrics.js';

/**
 * Slice 8 — the paging loop. The protocol computes every signal that matters (Layer-A
 * anomalies, pattern cheaters, rapid declines, money-shaped sweep rules); AlertService
 * is the seam that carries them to a human. One outbound webhook, no new infra: a dead
 * channel must never break settlement, so `raise()` is fire-and-forget and never throws.
 */

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface Alert {
  /** Stable id for dedup/cooldown, e.g. 'layer-a-anomaly:0xwallet'. */
  key: string;
  /** Rule id, e.g. 'layer-a-anomaly' — must match a `## <rule>` runbook section. */
  rule: string;
  severity: AlertSeverity;
  /** One line, human. */
  title: string;
  /** What happened + the numbers. */
  detail: string;
  /** Absolute URL into docs/RUNBOOK_ALERTS.md#<rule>. */
  runbook: string;
  /** Epoch ms. */
  at: number;
}

export interface AlertSink {
  /** Throws on failure; AlertService catches + counts (never the caller). */
  deliver(alert: Alert): Promise<void>;
}

/** Where every alert's runbook link points (one section per rule id). */
export const RUNBOOK_URL_BASE =
  'https://github.com/ShavitR/querais/blob/main/docs/RUNBOOK_ALERTS.md';

export function runbookUrl(rule: string): string {
  return `${RUNBOOK_URL_BASE}#${rule}`;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

export interface AlertServiceOptions {
  /** Identical alert.key is suppressed for this long (in-memory; restart resets). */
  cooldownSeconds: number;
  /** Alerts below this severity are metric+log only (chatty-channel guard). */
  minSeverity: AlertSeverity;
}

/** What callers pass to raise(); the service stamps `at` and the runbook URL. */
export type AlertInput = Omit<Alert, 'at' | 'runbook'>;

/**
 * The alert front door: severity floor, per-key cooldown, delivery metrics. Cooldown is
 * consumed at raise time (not on delivery success) so a flapping condition with a dead
 * webhook can't storm the channel the moment it recovers — the next occurrence after
 * the cooldown re-raises (the documented no-retry-queue trade-off).
 */
export class AlertService {
  private readonly lastRaised = new Map<string, number>();

  constructor(
    private readonly sink: AlertSink,
    private readonly logger: Logger,
    private readonly opts: AlertServiceOptions,
  ) {}

  /** Fire-and-forget: never throws, never blocks the caller on the webhook. */
  raise(input: AlertInput): void {
    try {
      const alert: Alert = { ...input, runbook: runbookUrl(input.rule), at: Date.now() };
      metrics.alertsRaised += 1;
      metrics.alertsRaisedBySeverity[alert.severity] += 1;
      if (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[this.opts.minSeverity]) {
        metrics.alertsSuppressed += 1;
        this.logger.info(
          { rule: alert.rule, key: alert.key, severity: alert.severity },
          'alert below severity floor — logged only',
        );
        return;
      }
      const last = this.lastRaised.get(alert.key);
      if (last !== undefined && alert.at - last < this.opts.cooldownSeconds * 1000) {
        metrics.alertsSuppressed += 1;
        return;
      }
      this.lastRaised.set(alert.key, alert.at);
      this.logger.warn(
        { rule: alert.rule, key: alert.key, severity: alert.severity, detail: alert.detail },
        `ALERT: ${alert.title}`,
      );
      void this.sink.deliver(alert).then(
        () => {
          metrics.alertsDelivered += 1;
        },
        (err: unknown) => {
          metrics.alertsFailed += 1;
          this.logger.error({ err, rule: alert.rule, key: alert.key }, 'alert delivery failed');
        },
      );
    } catch (err) {
      // raise() sits inside settlement/oracle paths — an alerting bug must stay here.
      this.logger.error({ err }, 'alert raise failed (non-fatal)');
    }
  }

  /**
   * The /v1/admin/alerts/test path: push a synthetic alert straight through the sink,
   * bypassing floor + cooldown, and report the outcome so the operator can verify the
   * channel end-to-end.
   */
  async deliverTest(): Promise<{ delivered: boolean; error?: string }> {
    const alert: Alert = {
      key: 'test',
      rule: 'test',
      severity: 'info',
      title: 'QueraIS test alert',
      detail: 'Synthetic alert from POST /v1/admin/alerts/test — the channel works.',
      runbook: runbookUrl('test'),
      at: Date.now(),
    };
    try {
      await this.sink.deliver(alert);
      metrics.alertsDelivered += 1;
      return { delivered: true };
    } catch (err) {
      metrics.alertsFailed += 1;
      return { delivered: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Sinks ─────────────────────────────────────────────────────────────────────────

export type WebhookFormat = 'discord' | 'slack' | 'generic';

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: '🔵',
  warn: '🟠',
  critical: '🔴',
};

/** The webhook URL is a secret (Discord/Slack URLs embed a token) — log host only. */
export function redactWebhookUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '<invalid url>';
  }
}

function renderText(alert: Alert): string {
  return `${SEVERITY_EMOJI[alert.severity]} **${alert.title}**\n${alert.detail}\nRunbook: ${alert.runbook}`;
}

/**
 * One outbound `fetch(POST)` with a 5 s timeout. Format selects the body shape:
 * `discord` → `{content}`, `slack` → `{text}` (also Mattermost/Rocket.Chat),
 * `generic` → the raw Alert JSON (Telegram bridges, custom receivers).
 */
export class WebhookSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly format: WebhookFormat,
    /** Injectable for tests; production uses global fetch. */
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async deliver(alert: Alert): Promise<void> {
    const body =
      this.format === 'discord'
        ? { content: renderText(alert) }
        : this.format === 'slack'
          ? { text: renderText(alert) }
          : alert;
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // Redaction discipline: errors carry the status + host, never the full URL.
    if (!res.ok) {
      throw new Error(`webhook ${redactWebhookUrl(this.url)} responded HTTP ${String(res.status)}`);
    }
  }
}

/** No URL configured → alerting off; the gateway must run fine without it. */
export class NoopSink implements AlertSink {
  async deliver(): Promise<void> {
    /* intentionally nothing */
  }
}

/** Test sink: captures every delivered alert for assertions. */
export class MemorySink implements AlertSink {
  readonly alerts: Alert[] = [];
  /** When set, deliver() rejects with this error (failure-path tests). */
  failWith?: Error;

  async deliver(alert: Alert): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.alerts.push(alert);
  }
}
