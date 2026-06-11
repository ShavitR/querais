import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';

/**
 * GET /v1/admin/incentives — the Slice 6C payout recommendation (admin-gated like
 * /v1/keys). Read-only: the gateway computes WHAT to pay from telemetry + chain state;
 * the operator executes each line from the cold key via `pnpm ops:allocate`
 * (docs/INCENTIVES.md). One-time bonuses dedup against on-chain Allocated purposes,
 * so re-querying after a payout drops the paid lines automatically.
 */
export function registerIncentives(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/admin/incentives', async (request, reply) => {
    const admin = deps.config.adminToken;
    if (!admin || request.headers['x-admin-token'] !== admin) {
      return reply.code(401).send(openAiError('admin token required', 'unauthorized'));
    }
    return reply.code(200).send(await deps.incentives.computeRecommendation());
  });
}
