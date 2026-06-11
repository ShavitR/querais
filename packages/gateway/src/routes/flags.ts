import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Address } from 'viem';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';

/**
 * Slice 8 review queue — the admin's to-do list. Every flag the verification layer
 * raises (Layer-A anomaly, output pattern, rapid decline) stays "open" here until a
 * human marks it reviewed. Gated by `x-admin-token`, same guard as routes/keys.ts.
 *
 *   GET  /v1/admin/flags?status=open|all&wallet=0x..&limit=50&offset=0
 *   POST /v1/admin/flags/:id/review  body { by, note? } → 200 | 404 | 409
 */
export function registerFlags(app: FastifyInstance, deps: GatewayDeps): void {
  const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const admin = deps.config.adminToken;
    if (!admin || request.headers['x-admin-token'] !== admin) {
      void reply.code(401).send(openAiError('admin token required', 'unauthorized'));
      return false;
    }
    return true;
  };

  app.get('/v1/admin/flags', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const q = request.query as {
      status?: string;
      wallet?: string;
      limit?: string;
      offset?: string;
    };
    if (q.status !== undefined && q.status !== 'open' && q.status !== 'all') {
      return reply.code(400).send(openAiError('status must be "open" or "all"', 'invalid_request'));
    }
    if (q.wallet !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(q.wallet)) {
      return reply.code(400).send(openAiError('wallet must be a 0x address', 'invalid_request'));
    }
    const limit = q.limit === undefined ? undefined : Number(q.limit);
    const offset = q.offset === undefined ? undefined : Number(q.offset);
    if (
      (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) ||
      (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
    ) {
      return reply
        .code(400)
        .send(openAiError('limit/offset must be non-negative integers', 'invalid_request'));
    }
    const flags = deps.nodeFlags.list({
      status: q.status as 'open' | 'all' | undefined,
      wallet: q.wallet as Address | undefined,
      limit,
      offset,
    });
    return reply.send({ flags, openCount: deps.nodeFlags.openCount() });
  });

  app.post('/v1/admin/flags/:id/review', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.code(400).send(openAiError('flag id must be a positive integer', 'invalid_request'));
    }
    const body = request.body as { by?: string; note?: string } | undefined;
    const by = body?.by?.trim();
    if (!by) {
      return reply.code(400).send(openAiError('"by" (reviewer name) is required', 'invalid_request'));
    }
    const result = deps.nodeFlags.markReviewed(id, by, body?.note);
    switch (result.outcome) {
      case 'ok':
        return reply.send({ flag: result.flag });
      case 'not-found':
        return reply.code(404).send(openAiError(`no flag with id ${String(id)}`, 'not_found'));
      case 'already-reviewed':
        return reply.code(409).send(openAiError('flag is already reviewed', 'conflict'));
    }
  });
}
