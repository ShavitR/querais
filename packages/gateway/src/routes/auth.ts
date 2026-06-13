import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';
import { SESSION_COOKIE } from '../session.js';

/**
 * Slice 10A — web-app sign-in. The browser posts an API key ONCE; the gateway validates it
 * against the key store and mints a stateless, httpOnly session cookie (the key is never
 * stored client-side). Bearer auth (SDK/CLI/curl) is unchanged and still wins where present.
 *
 * Wallet (SIWE) sign-in is 10B: it mints the SAME cookie via a signature proof, so this
 * route set grows a sibling but `/v1/auth/me` and the cookie format stay put.
 */
export function registerAuth(app: FastifyInstance, deps: GatewayDeps): void {
  const setCookie = (reply: FastifyReply, token: string): void => {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: 'auto', // https → Secure; plain-http localhost/e2e → not (still set)
      path: '/',
      maxAge: deps.session.ttlSeconds,
    });
  };

  // Exchange an API key for a session cookie.
  app.post('/v1/auth/session', async (request, reply) => {
    const body = request.body as { apiKey?: string } | undefined;
    const apiKey = body?.apiKey?.trim();
    if (!apiKey) {
      return reply.code(400).send(openAiError('apiKey is required', 'invalid_request'));
    }
    const wallet = deps.keyStore.get(apiKey);
    if (!wallet) {
      return reply.code(401).send(openAiError('invalid API key', 'invalid_request'));
    }
    const tier = deps.keyStore.tierOf(apiKey) ?? 'free';
    setCookie(reply, deps.session.mint(wallet, tier));
    return reply.send({ wallet, tier });
  });

  // Who am I? Resolves the cookie; 401 when signed out (the app treats that as public mode).
  app.get('/v1/auth/me', async (request, reply) => {
    const claims = deps.session.verify(request.cookies[SESSION_COOKIE]);
    if (!claims) {
      return reply.code(401).send(openAiError('not signed in', 'invalid_request'));
    }
    return reply.send({ wallet: claims.wallet, tier: claims.tier });
  });

  // Drop the cookie.
  app.post('/v1/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });
}
