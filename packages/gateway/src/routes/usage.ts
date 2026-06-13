import type { FastifyInstance } from 'fastify';
import { AuthError } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';
import { resolveRequesterOrSession } from '../auth.js';
import { SESSION_COOKIE } from '../session.js';

/**
 * GET /v1/usage — per-requester usage, derived from settled job rows (jobs served, tokens,
 * QAIS spent in wei). Authenticated by the Bearer API key (SDK/CLI) OR the web-app session
 * cookie (Slice 10A).
 */
export function registerUsage(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/usage', async (request, reply) => {
    let wallet;
    try {
      wallet = resolveRequesterOrSession(
        deps.keyStore,
        deps.session,
        request.headers.authorization,
        request.cookies[SESSION_COOKIE],
      );
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send(openAiError(err.message, 'invalid_request'));
      }
      throw err;
    }
    const usage = deps.jobs.usageFor(wallet);
    return { wallet, ...usage };
  });
}
