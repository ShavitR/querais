import type { AlertService } from './alerts.js';
import type { KeeperStatus } from './keeper-health.js';

/** Sweep-rule thresholds (env-overridable via GATEWAY_ALERT_*, resolved in config). */
export interface SweepThresholds {
  /** `gas-low` fires when the hot wallet's ETH drops below this. */
  gasMinWei: bigint;
  /** `stuck-debits` fires when the oldest unflushed debit is older than this. */
  debitMaxAgeSeconds: number;
  /** `settlement-failures` fires at this many consecutive flush failures. */
  settleFailStreak: number;
}

/**
 * Everything the sweep reads, injected — unit tests fake these (no RPC), production
 * wires them to ChainClient / BatchedSettlement / NodePool / NodeFlagStore / KeeperHealth.
 */
export interface SweepReads {
  /** Gateway hot-wallet ETH — every settle/snapshot/keeper tx dies without gas. */
  gasBalanceWei(): Promise<bigint>;
  oldestPendingDebitAt(): number | undefined;
  consecutiveFlushFailures(): number;
  connectedNodes(): number;
  openFlagCount(): number;
  /** Absent when no faucet is configured (faucet-low is then skipped). */
  faucet?: {
    qaisBalance(): Promise<bigint>;
    ethBalance(): Promise<bigint>;
    claimQaisWei: bigint;
    claimEthWei: bigint;
  };
  staleKeepers(now: number): KeeperStatus[];
  /** Cheap RPC liveness probe (a block read); rejects on failure. */
  rpcProbe(): Promise<void>;
}

function eth(wei: bigint): string {
  // Display only — precision loss past ~15 digits is fine for an alert line.
  return (Number(wei) / 1e18).toFixed(6);
}

/**
 * The Slice 8 sweep keeper's brain: every rule from the catalogue, evaluated over
 * injected reads. The sweeper holds the cross-sweep state (node high-water mark, RPC
 * failure streak); dedup/cooldown lives in AlertService, so re-raising every sweep is
 * cheap and correct. `sweep()` never throws — a broken RPC is `rpc-degraded`'s job
 * to report, not a crash.
 */
export class AlertSweeper {
  // node-drop: high-water mark of connected nodes with hourly decay.
  private maxNodes = 0;
  private maxNodesAt = 0;
  // rpc-degraded: consecutive failed probes (>= 3 pages).
  private rpcFailStreak = 0;

  constructor(
    private readonly alerts: AlertService,
    private readonly reads: SweepReads,
    private readonly thresholds: SweepThresholds,
  ) {}

  async sweep(now: number = Date.now()): Promise<void> {
    // RPC probe first: it gates how to read the balance-rule failures below.
    let rpcUp = true;
    try {
      await this.reads.rpcProbe();
      this.rpcFailStreak = 0;
    } catch {
      rpcUp = false;
      this.rpcFailStreak += 1;
      if (this.rpcFailStreak >= 3) {
        this.alerts.raise({
          key: 'rpc-degraded',
          rule: 'rpc-degraded',
          severity: 'critical',
          title: 'RPC degraded — chain unreachable',
          detail: `${String(this.rpcFailStreak)} consecutive probe failures; everything chain-touching (settlement, snapshots, treasury) is down`,
        });
      }
    }

    // gas-low — tolerate read failure (rpc-degraded covers the cause).
    if (rpcUp) {
      try {
        const gas = await this.reads.gasBalanceWei();
        if (gas < this.thresholds.gasMinWei) {
          this.alerts.raise({
            key: 'gas-low',
            rule: 'gas-low',
            severity: 'critical',
            title: 'Gateway hot wallet is low on gas',
            detail: `balance ${eth(gas)} ETH < floor ${eth(this.thresholds.gasMinWei)} ETH — settle/snapshot/keeper txs will start failing`,
          });
        }
      } catch {
        /* balance read failed — the probe above owns RPC health */
      }
    }

    // stuck-debits — settlement stuck means nodes are silently unpaid.
    const oldest = this.reads.oldestPendingDebitAt();
    if (oldest !== undefined) {
      const ageSeconds = Math.floor((now - oldest) / 1000);
      if (ageSeconds > this.thresholds.debitMaxAgeSeconds) {
        this.alerts.raise({
          key: 'stuck-debits',
          rule: 'stuck-debits',
          severity: 'critical',
          title: 'Pending debits are stuck',
          detail: `oldest unflushed debit is ${String(ageSeconds)}s old (max ${String(this.thresholds.debitMaxAgeSeconds)}s) — providers are not being paid`,
        });
      }
    }

    // settlement-failures — a streak means liability is accumulating.
    const streak = this.reads.consecutiveFlushFailures();
    if (streak >= this.thresholds.settleFailStreak) {
      this.alerts.raise({
        key: 'settlement-failures',
        rule: 'settlement-failures',
        severity: 'critical',
        title: 'Consecutive settlement failures',
        detail: `${String(streak)} batchSettle attempts failed in a row (threshold ${String(this.thresholds.settleFailStreak)}) — check RPC, gas, and session caps`,
      });
    }

    // node-drop — high-water mark with hourly decay; needs max >= 2 to mean anything.
    const connected = this.reads.connectedNodes();
    if (now - this.maxNodesAt > 3_600_000) {
      this.maxNodes = connected;
      this.maxNodesAt = now;
    }
    if (connected > this.maxNodes) {
      this.maxNodes = connected;
      this.maxNodesAt = now;
    }
    if (this.maxNodes >= 2 && connected * 2 <= this.maxNodes) {
      this.alerts.raise({
        key: 'node-drop',
        rule: 'node-drop',
        severity: 'warn',
        title: 'Connected nodes dropped sharply',
        detail: `${String(connected)} connected vs a high of ${String(this.maxNodes)} in the last hour — capacity loss or network event`,
      });
    }

    // open-flags — the review queue is non-empty; cooldown keeps this to one page/hour.
    const open = this.reads.openFlagCount();
    if (open > 0) {
      this.alerts.raise({
        key: 'open-flags',
        rule: 'open-flags',
        severity: 'warn',
        title: 'Open review flags awaiting a human',
        detail: `${String(open)} unreviewed flag(s) — GET /v1/admin/flags, review, POST /v1/admin/flags/:id/review`,
      });
    }

    // faucet-low — onboarding silently breaks when the well runs dry.
    if (rpcUp && this.reads.faucet) {
      try {
        const f = this.reads.faucet;
        const [qais, fEth] = await Promise.all([f.qaisBalance(), f.ethBalance()]);
        const lowQais = qais < 10n * f.claimQaisWei;
        const lowEth = f.claimEthWei > 0n && fEth < 10n * f.claimEthWei;
        if (lowQais || lowEth) {
          this.alerts.raise({
            key: 'faucet-low',
            rule: 'faucet-low',
            severity: 'warn',
            title: 'Faucet is running dry',
            detail: `faucet holds ${eth(qais)} QAIS / ${eth(fEth)} ETH — under 10 claims of headroom; onboarding will start refusing`,
          });
        }
      } catch {
        /* balance read failed — the probe above owns RPC health */
      }
    }

    // keeper-stale — a timer that died silently (one alert key per keeper).
    for (const k of this.reads.staleKeepers(now)) {
      const staleSeconds = Math.floor((now - k.lastSuccessAt) / 1000);
      this.alerts.raise({
        key: `keeper-stale:${k.name}`,
        rule: 'keeper-stale',
        severity: 'warn',
        title: `Keeper "${k.name}" is stale`,
        detail: `last success ${String(staleSeconds)}s ago (interval ${String(Math.floor(k.intervalMs / 1000))}s) — the timer died or its work keeps failing`,
      });
    }
  }
}
