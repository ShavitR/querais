import { formatEther } from 'viem';
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

/** GET /v1/stats — pool size, models, and live treasury balance (for the dashboard). */
export function registerStats(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/stats', async () => {
    const treasury = deps.chain.deployment.treasury;
    const treasuryBalance = await deps.chain.tokenBalance(treasury);
    return {
      nodes: deps.pool.size(),
      models: deps.pool.availableModels(),
      treasury: {
        address: treasury,
        balanceQais: formatEther(treasuryBalance),
      },
    };
  });
}
