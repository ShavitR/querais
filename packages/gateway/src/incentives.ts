import type { Address } from 'viem';
import type { Logger } from 'pino';
import { formatEther } from 'viem';
import type { ChainClient } from './chain-client.js';
import type { JobStore } from './db/jobs.js';
import type { NodeSessionStore } from './db/node-sessions.js';
import { uptimeRatioBps, TELEMETRY_WINDOW_MS } from './reputation.js';

/**
 * Slice 6C — node incentive programs (ops, not protocol). The gateway COMPUTES a payout
 * recommendation from telemetry the protocol already collects; the OPERATOR executes it
 * from the cold admin key via `ProtocolTreasury.allocate()` (`pnpm ops:allocate`).
 * Nothing here moves money. Formulas + operator flow: docs/INCENTIVES.md.
 *
 * Paid-state is DERIVED FROM CHAIN, not a table: every allocate() emits
 * `Allocated(recipient, amount, purpose)`, and one-time bonuses use canonical purpose
 * strings (below) — a bonus disappears from the recommendation once its purpose has
 * been paid on-chain. The thin-DB rule holds: no payout bookkeeping to drift.
 */

/** Canonical allocate() purpose strings (the on-chain dedup keys). */
export function firstModelPurpose(model: string): string {
  return `incentive:first-model:${model}`;
}
export function bootstrapPurpose(wallet: Address): string {
  return `incentive:bootstrap:${wallet.toLowerCase()}`;
}
export function uptimePurpose(wallet: Address, epochDay: string): string {
  return `incentive:uptime:${epochDay}:${wallet.toLowerCase()}`;
}

/** The spec's loyalty multiplier table (token economics §9), applied by node TENURE
 *  (registeredAt) — the Phase-1 proxy for "holding period" (true unmoved-earnings
 *  tracking needs wallet outflow analysis; deferred). Returned in bps (10000 = 1.00×). */
export function tenureMultiplierBps(tenureDays: number): number {
  if (tenureDays >= 90) return 12500;
  if (tenureDays >= 60) return 11500;
  if (tenureDays >= 30) return 10500;
  return 10000;
}

/** Equal split of the uptime pool among qualifiers; dust stays unallocated. */
export function splitUptimePool(budgetWei: bigint, eligibleCount: number): bigint {
  if (eligibleCount <= 0) return 0n;
  return budgetWei / BigInt(eligibleCount);
}

export interface IncentiveConfig {
  /** Uptime-pool budget per epoch, in QAIS (split equally among qualifiers). */
  uptimePoolQais: number;
  /** Minimum 30d uptime to qualify for the pool (bps; go-to-market KPI: 95%). */
  uptimeThresholdBps: number;
  /** One-time bonus per (model, first provider), in QAIS. */
  firstModelBonusQais: number;
  /** One-time launch bonus, in QAIS (go-to-market: 5,000 for the first 100 nodes
   *  that run for 30 days). */
  bootstrapBonusQais: number;
  bootstrapMaxNodes: number;
  bootstrapMinTenureDays: number;
}

export const INCENTIVE_DEFAULTS: IncentiveConfig = {
  uptimePoolQais: 100,
  uptimeThresholdBps: 9500,
  firstModelBonusQais: 50,
  bootstrapBonusQais: 5000,
  bootstrapMaxNodes: 100,
  bootstrapMinTenureDays: 30,
};

export function resolveIncentives(partial?: Partial<IncentiveConfig>): IncentiveConfig {
  return { ...INCENTIVE_DEFAULTS, ...partial };
}

/** One ready-to-execute allocate() line for the operator. */
export interface PayoutLine {
  recipient: Address;
  amountWei: string;
  amountQais: string;
  purpose: string;
  program: 'uptime-pool' | 'first-model' | 'bootstrap';
}

export interface NodeIncentives {
  wallet: Address;
  tenureDays: number;
  multiplierBps: number;
  uptimeBps: number;
  uptimeEligible: boolean;
  totalWei: string;
}

export interface IncentiveRecommendation {
  epochDay: string; // YYYY-MM-DD — keys the uptime purposes (one pool per day max)
  nodes: NodeIncentives[];
  payouts: PayoutLine[];
  totalRecommendedWei: string;
  /** The treasury's spendable ops share — allocate() reverts beyond this. */
  opsSpendableWei: string;
  fundsSufficient: boolean;
}

const QAIS = 10n ** 18n;
const DAY_MS = 86_400_000;

/** Computes the payout recommendation. Pure derivation: chain reads + telemetry. */
export class IncentiveService {
  constructor(
    private readonly chain: ChainClient,
    private readonly sessions: NodeSessionStore,
    private readonly jobs: JobStore,
    private readonly cfg: IncentiveConfig,
    private readonly logger: Logger,
  ) {}

  async computeRecommendation(): Promise<IncentiveRecommendation> {
    const nowMs = Date.now();
    const epochDay = new Date(nowMs).toISOString().slice(0, 10);
    const windowStartMs = nowMs - TELEMETRY_WINDOW_MS;

    const wallets = await this.chain.activeNodeWallets();
    const paid = new Set(await this.chain.allocatedPurposes());

    // Per-node tenure + uptime.
    const infos = await Promise.all(
      wallets.map(async (wallet) => {
        const node = await this.chain.getNode(wallet);
        const tenureDays = Math.max(0, (nowMs - Number(node.registeredAt) * 1000) / DAY_MS);
        const uptimeBps = uptimeRatioBps(
          this.sessions.intervalsSince(wallet, windowStartMs),
          windowStartMs,
          nowMs,
        );
        return { wallet, tenureDays, registeredAt: Number(node.registeredAt), uptimeBps };
      }),
    );

    const payouts: PayoutLine[] = [];
    const perNodeWei = new Map<Address, bigint>();
    const add = (line: PayoutLine) => {
      payouts.push(line);
      // Keyed lowercase: registry wallets are checksummed, job rows are lowercased.
      const key = line.recipient.toLowerCase() as Address;
      perNodeWei.set(key, (perNodeWei.get(key) ?? 0n) + BigInt(line.amountWei));
    };
    const line = (
      recipient: Address,
      amountWei: bigint,
      purpose: string,
      program: PayoutLine['program'],
    ): PayoutLine => ({
      recipient,
      amountWei: amountWei.toString(),
      amountQais: formatEther(amountWei),
      purpose,
      program,
    });

    // 1. Uptime pool: equal split among qualifiers, scaled by the tenure multiplier.
    //    One pool per epochDay (the purpose string dedups re-runs the same day).
    const eligible = infos.filter((n) => n.uptimeBps >= this.cfg.uptimeThresholdBps);
    const share = splitUptimePool(BigInt(this.cfg.uptimePoolQais) * QAIS, eligible.length);
    for (const n of eligible) {
      const purpose = uptimePurpose(n.wallet, epochDay);
      if (paid.has(purpose) || share === 0n) continue;
      const boosted = (share * BigInt(tenureMultiplierBps(n.tenureDays))) / 10000n;
      add(line(n.wallet, boosted, purpose, 'uptime-pool'));
    }

    // 2. First-model bonus: the provider that settled the first verified job per model.
    const firstProviders = this.jobs.firstProviderByModel();
    for (const [model, provider] of firstProviders) {
      const purpose = firstModelPurpose(model);
      if (paid.has(purpose)) continue;
      add(line(provider, BigInt(this.cfg.firstModelBonusQais) * QAIS, purpose, 'first-model'));
    }

    // 3. Bootstrap launch bonus: the earliest-registered N active nodes with >=30d
    //    tenure (Phase-1 approximation of "first N nodes" — unbonded ones are gone).
    const earliest = [...infos]
      .sort((a, b) => a.registeredAt - b.registeredAt)
      .slice(0, this.cfg.bootstrapMaxNodes);
    for (const n of earliest) {
      if (n.tenureDays < this.cfg.bootstrapMinTenureDays) continue;
      const purpose = bootstrapPurpose(n.wallet);
      if (paid.has(purpose)) continue;
      add(line(n.wallet, BigInt(this.cfg.bootstrapBonusQais) * QAIS, purpose, 'bootstrap'));
    }

    const totalRecommendedWei = payouts.reduce((sum, p) => sum + BigInt(p.amountWei), 0n);
    const opsSpendableWei = await this.chain.treasuryOpsRetained();
    this.logger.info(
      { payouts: payouts.length, totalQais: formatEther(totalRecommendedWei) },
      'incentive recommendation computed',
    );

    return {
      epochDay,
      nodes: infos.map((n) => ({
        wallet: n.wallet,
        tenureDays: Math.round(n.tenureDays * 100) / 100,
        multiplierBps: tenureMultiplierBps(n.tenureDays),
        uptimeBps: n.uptimeBps,
        uptimeEligible: n.uptimeBps >= this.cfg.uptimeThresholdBps,
        totalWei: (perNodeWei.get(n.wallet.toLowerCase() as Address) ?? 0n).toString(),
      })),
      payouts,
      totalRecommendedWei: totalRecommendedWei.toString(),
      opsSpendableWei: opsSpendableWei.toString(),
      fundsSufficient: totalRecommendedWei <= opsSpendableWei,
    };
  }
}
