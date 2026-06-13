import type { FastifyInstance, FastifyReply } from 'fastify';
import { recoverMessageAddress } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';
import { SESSION_COOKIE } from '../session.js';

/**
 * Web-app sign-in. Two proofs, ONE outcome — a stateless, httpOnly session cookie
 * (`SessionAuth`); `/v1/auth/me` + `/v1/auth/logout` work the same regardless of how you
 * signed in. Bearer auth (SDK/CLI/curl) is unchanged and still wins where present.
 *  - Slice 10A: API key (`POST /v1/auth/session`) — the key is never stored client-side.
 *  - Slice 10B-2: wallet via EIP-4361 SIWE (`POST /v1/auth/nonce` → sign → `POST /v1/auth/wallet`).
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

  // --- Slice 10B-2: wallet sign-in via EIP-4361 (Sign-In with Ethereum) ---

  // Step 1: hand out a single-use-ish nonce for the SIWE message (stateless, expiry-bound).
  app.post('/v1/auth/nonce', async (_request, reply) => {
    return reply.send({ nonce: deps.session.siweNonce() });
  });

  // Step 2: verify the signed SIWE message and mint the session cookie for its address.
  app.post('/v1/auth/wallet', async (request, reply) => {
    const body = request.body as { message?: string; signature?: string } | undefined;
    const message = body?.message;
    const signature = body?.signature as `0x${string}` | undefined;
    if (!message || !signature) {
      return reply
        .code(400)
        .send(openAiError('message and signature are required', 'invalid_request'));
    }
    const fields = parseSiweMessage(message);
    if (!fields.address || !fields.nonce) {
      return reply.code(400).send(openAiError('malformed SIWE message', 'invalid_request'));
    }
    // The nonce must be one we issued and unexpired (replay guard).
    if (!deps.session.verifySiweNonce(fields.nonce)) {
      return reply.code(401).send(openAiError('invalid or expired nonce', 'invalid_request'));
    }
    // Bind the message to THIS deployment's chain (prevents cross-chain replay).
    if (fields.chainId !== deps.chain.deployment.chainId) {
      return reply.code(400).send(openAiError('wrong chain for this gateway', 'invalid_request'));
    }
    // EIP-4361 time fields (issuedAt / expirationTime / notBefore) and address consistency.
    if (!validateSiweMessage({ message: fields, address: fields.address })) {
      return reply.code(401).send(openAiError('SIWE message failed validation', 'invalid_request'));
    }
    // Recover the EOA signer and require it match the claimed address.
    let recovered: `0x${string}`;
    try {
      recovered = await recoverMessageAddress({ message, signature });
    } catch {
      return reply.code(401).send(openAiError('bad signature', 'invalid_request'));
    }
    if (recovered.toLowerCase() !== fields.address.toLowerCase()) {
      return reply
        .code(401)
        .send(openAiError('signature does not match address', 'invalid_request'));
    }
    // A pure-wallet principal gets the free tier (10B-2 decision).
    const wallet = recovered.toLowerCase() as `0x${string}`;
    setCookie(reply, deps.session.mint(wallet, 'free'));
    return reply.send({ wallet, tier: 'free' });
  });
}
