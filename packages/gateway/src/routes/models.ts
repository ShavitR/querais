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
}
