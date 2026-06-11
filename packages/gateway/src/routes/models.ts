import type { FastifyInstance } from 'fastify';
import type { ModelListResponse } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';

/** GET /v1/models — the models currently served by nodes in the pool. */
export function registerModels(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/models', async (): Promise<ModelListResponse> => {
    return {
      object: 'list',
      data: deps.pool.availableModels().map((id) => ({
        id,
        object: 'model',
        owned_by: 'querais',
      })),
    };
  });

  // Slice 9: the signed model manifest — daemons fetch this to self-verify
  // their local model digests before connecting (signature checked against
  // the settler address from /v1/credit/info). 404 = operator runs without
  // digest enforcement.
  app.get('/v1/models/manifest', async (_req, reply) => {
    if (!deps.modelManifest) {
      return reply.code(404).send({ error: 'no model manifest configured' });
    }
    return deps.modelManifest;
  });
}
