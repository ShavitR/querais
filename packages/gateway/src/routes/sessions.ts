import type { FastifyInstance } from 'fastify';
import {
  recoverSpendingCapSigner,
  signedSpendingCapSchema,
  spendingCapDomain,
  toSpendingCap,
  type Address,
} from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { resolveRequester } from '../auth.js';
import { openAiError, sendError } from '../http.js';
import { buildSessionStatus } from '../session-status.js';

/**
 * Slice 2 credit sessions.
 *  - GET  /v1/credit/info  → the data a client needs to build + sign a spending cap.
 *  - POST /v1/sessions     → register a signed cap so this key's jobs batch-settle.
 *  - GET  /v1/sessions     → the requester's live session/credit/headroom view (Slice 3B).
 */
export function registerSessions(app: FastifyInstance, deps: GatewayDeps): void {
  const { deployment } = deps.chain;

  app.get('/v1/credit/info', async () => ({
    chainId: deployment.chainId,
    creditAccount: deployment.contracts.creditAccount,
    token: deployment.contracts.token,
    settler: deps.settler,
  }));

  app.get('/v1/sessions', async (request, reply) => {
    let requester: Address;
    try {
      requester = resolveRequester(deps.keyStore, request.headers.authorization);
    } catch (err) {
      return sendError(reply, err);
    }
    if (!deps.sessions || !deps.ledger) {
      return reply.code(404).send(openAiError('credit sessions not enabled', 'not_found'));
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = deps.sessions.getActive(requester, nowSeconds);
    const pending = deps.ledger.pending(requester);
    const pendingTotalWei = pending.reduce((sum, d) => sum + d.amountWei, 0n);
    const [spentAgainstWei, creditBalanceWei] = await Promise.all([
      session ? deps.chain.spentAgainst(requester, session.nonce) : Promise.resolve(0n),
      deps.chain.creditBalance(requester),
    ]);

    return reply.send(
      buildSessionStatus({
        requester,
        settler: deps.settler,
        session,
        spentAgainstWei,
        creditBalanceWei,
        pendingCount: pending.length,
        pendingTotalWei,
      }),
    );
  });

  app.post('/v1/sessions', async (request, reply) => {
    let requester: Address;
    try {
      requester = resolveRequester(deps.keyStore, request.headers.authorization);
    } catch (err) {
      return sendError(reply, err);
    }
    if (!deps.sessions) {
      return reply.code(404).send(openAiError('credit sessions not enabled', 'not_found'));
    }

    const parsed = signedSpendingCapSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(openAiError(parsed.error.message, 'invalid_request'));
    }
    const { cap, signature } = toSpendingCap(parsed.data);

    if (cap.requester.toLowerCase() !== requester.toLowerCase()) {
      return reply
        .code(400)
        .send(openAiError('cap requester must match the API key', 'invalid_request'));
    }
    if (cap.settler.toLowerCase() !== deps.settler.toLowerCase()) {
      return reply
        .code(400)
        .send(openAiError('cap settler must be this gateway', 'invalid_request'));
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (cap.deadline <= BigInt(nowSeconds)) {
      return reply.code(400).send(openAiError('cap is already expired', 'invalid_request'));
    }

    const domain = spendingCapDomain(deployment.chainId, deployment.contracts.creditAccount);
    const signer = await recoverSpendingCapSigner(cap, domain, signature);
    if (signer.toLowerCase() !== requester.toLowerCase()) {
      return reply.code(401).send(openAiError('signature is not from the requester', 'auth_error'));
    }

    deps.sessions.upsert({ ...cap, signature });
    return reply.send({
      ok: true,
      requester,
      settler: deps.settler,
      nonce: cap.nonce.toString(),
      maxSpendWei: cap.maxSpendWei.toString(),
      deadline: cap.deadline.toString(),
    });
  });
}
