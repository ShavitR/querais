import { formatEther } from 'viem';
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { metrics } from '../metrics.js';

/** GET /v1/stats — pool size, models, treasury balance, and job metrics (dashboard). */
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
      jobs: {
        created: metrics.jobsCreated,
        settled: metrics.jobsSettled,
        failed: metrics.jobsFailed,
        tokensServed: metrics.tokensServed,
      },
    };
  });
}
