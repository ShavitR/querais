import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';

/**
 * Slice 9: disclosures ride with every issued key — no key without terms attached.
 * Canonical home is the repo until the docs site (10E) gives them a domain.
 */
export const TERMS_URL = 'https://github.com/ShavitR/querais/blob/main/docs/TERMS.md';
export const PRIVACY_URL = 'https://github.com/ShavitR/querais/blob/main/docs/PRIVACY.md';

/**
 * POST /v1/keys — admin-gated self-serve API-key issuance. Body: { wallet }. Returns a
 * new API key bound to that wallet. Gated by the `x-admin-token` header (the onboarding
 * service holds the admin token).
 */
export function registerKeys(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/v1/keys', async (request, reply) => {
    const admin = deps.config.adminToken;
    if (!admin || request.headers['x-admin-token'] !== admin) {
      return reply.code(401).send(openAiError('admin token required', 'unauthorized'));
    }
    const body = request.body as { wallet?: string; tier?: string } | undefined;
    const wallet = body?.wallet;
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return reply
        .code(400)
        .send(openAiError('a valid wallet address is required', 'invalid_request'));
    }
    // Optional quota tier (Slice 3); must be one of the configured tiers.
    const tier = body?.tier ?? 'free';
    if (!(tier in deps.hardening.quotaTiers)) {
      return reply.code(400).send(openAiError(`unknown tier "${tier}"`, 'invalid_request'));
    }
    const apiKey = deps.keyStore.issue(wallet as `0x${string}`, tier);
    // Disclosures travel with the key: using the key is accepting the terms.
    return reply.code(200).send({
      api_key: apiKey,
      wallet: wallet.toLowerCase(),
      tier,
      terms: TERMS_URL,
      privacy: PRIVACY_URL,
    });
  });
}
