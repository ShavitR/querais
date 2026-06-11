import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

/** GET /v1/nodes — browse the active nodes, their reputation breakdown, and models. */
export function registerNodes(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/nodes', async () => {
    const data = await Promise.all(
      deps.pool.listNodes().map(async (n) => {
        // The full 5-dimension breakdown (Slice 4) — the spec's public "Node Card".
        const d = await deps.reputation.dimensionsFor(n.wallet);
        return {
          wallet: n.wallet,
          nodeId: n.nodeId,
          reputation: d.compositeBps / 10000,
          dimensions: {
            accuracy: d.accuracyBps / 10000,
            uptime: d.uptimeBps / 10000,
            latency: d.latencyBps / 10000,
            longevity: d.longevityBps / 10000,
            stake: d.stakeBps / 10000,
          },
          // Slice 5: open manual-review flags (Layer-A anomalies, output patterns).
          flags: deps.nodeFlags.countFor(n.wallet),
          // Slice 6B: earned, unclaimed staking rewards (wei string; '0' pre-6B).
          claimableRewardsWei: (deps.chain.stakingRewardsContract()
            ? await deps.chain.claimableRewards(n.wallet)
            : 0n
          ).toString(),
          jobsServed: n.jobsServed,
          models: n.models.map((m) => ({
            model: m.model,
            pricePerTokenWei: m.pricePerTokenWei,
            tokensPerSecond: m.tokensPerSecond,
          })),
        };
      }),
    );
    return { object: 'list', data };
  });
}
