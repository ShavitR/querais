import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';

/**
 * Slice 8 channel check — POST /v1/admin/alerts/test fires a synthetic `info`
 * alert through the REAL sink (bypassing severity floor + cooldown) so an
 * operator can verify the Discord/Slack webhook end-to-end after rotating it.
 * Gated by `x-admin-token`, same guard as routes/flags.ts.
 */
export function registerAlertsAdmin(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/v1/admin/alerts/test', async (request, reply) => {
    const admin = deps.config.adminToken;
    if (!admin || request.headers['x-admin-token'] !== admin) {
      return reply.code(401).send(openAiError('admin token required', 'unauthorized'));
    }
    const result = await deps.alerts.deliverTest();
    // 502: the gateway is fine, the channel is not — the operator's cue to fix the webhook.
    return reply.code(result.delivered ? 200 : 502).send(result);
  });
}
