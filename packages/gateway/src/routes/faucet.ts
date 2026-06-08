import type { FastifyInstance } from 'fastify';
import type { Address } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';

/**
 * POST /v1/faucet — dispense testnet QAIS once per address. Only registered when a
 * distributor key is configured. Subject to the global rate limiter.
 */
export function registerFaucet(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/v1/faucet', async (request, reply) => {
    if (!deps.faucet) {
      return reply.code(404).send(openAiError('faucet not enabled', 'not_found'));
    }
    const body = request.body as { address?: string } | undefined;
    const address = body?.address;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return reply.code(400).send(openAiError('a valid address is required', 'invalid_request'));
    }
    try {
      const claim = await deps.faucet.claim(address as Address);
      return reply.send({
        ok: true,
        qaisTx: claim.qaisTx,
        ethTx: claim.ethTx ?? null,
        qais: deps.faucet.qaisAmount.toString(),
        eth: deps.faucet.ethAmount.toString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'faucet error';
      return reply.code(429).send(openAiError(message, 'faucet_refused'));
    }
  });
}
