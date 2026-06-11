/** One keeper's heartbeat record — registered at boot, beaten on each success. */
export interface KeeperStatus {
  name: string;
  intervalMs: number;
  lastSuccessAt: number;
}

/**
 * Slice 8 keeper liveness: every background timer (flush, snapshot, patterns, treasury,
 * alert sweep) registers here and beats on success. The `keeper-stale` sweep rule pages
 * when a keeper hasn't succeeded for over 2× its interval — a daily timer that died
 * silently is exactly the failure mode logs never surface.
 */
export class KeeperHealth {
  private readonly keepers = new Map<string, KeeperStatus>();

  /** Register at boot. Seeds lastSuccessAt = now so a keeper gets one full 2× interval
   *  of grace before it can be called stale (it hasn't had a chance to run yet). */
  register(name: string, intervalMs: number, now: number = Date.now()): void {
    this.keepers.set(name, { name, intervalMs, lastSuccessAt: now });
  }

  /** Record a successful run. Unknown names are ignored (never throw in a keeper). */
  beat(name: string, now: number = Date.now()): void {
    const k = this.keepers.get(name);
    if (k) k.lastSuccessAt = now;
  }

  /** Keepers whose last success is more than 2× their interval ago. */
  stale(now: number = Date.now()): KeeperStatus[] {
    return [...this.keepers.values()].filter((k) => now - k.lastSuccessAt > 2 * k.intervalMs);
  }

  /** All registered keepers (the /v1/status page + /metrics timestamps). */
  list(): KeeperStatus[] {
    return [...this.keepers.values()];
  }
}
