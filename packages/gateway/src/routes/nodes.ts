import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

/** GET /v1/nodes — browse the active nodes, their reputation, and offered models. */
export function registerNodes(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/nodes', async () => {
    return {
      object: 'list',
      data: deps.pool.listNodes().map((n) => ({
        wallet: n.wallet,
        nodeId: n.nodeId,
        reputation: n.reputation / 10000,
        jobsServed: n.jobsServed,
        models: n.models.map((m) => ({
          model: m.model,
          pricePerTokenWei: m.pricePerTokenWei,
          tokensPerSecond: m.tokensPerSecond,
        })),
      })),
    };
  });
}
