import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { keccak256, type Address, type Hex } from 'viem';
import { AuthError } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { requireWalletSession } from '../auth.js';
import { SESSION_COOKIE } from '../session.js';
import { openAiError, sendError } from '../http.js';

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/**
 * Slice 10C-2 — dispute reads + the admin-triggered FAST-track raise (5B). MONEY-MOVING:
 * `POST /v1/admin/disputes` slashes 20% of a node's stake on-chain (split 50% burn / 30%
 * challenger / 20% treasury) — admin-token-gated, and auto-disabled when no DisputeResolution
 * is deployed. Reads are public (disputes are public on-chain); the operator's own list is
 * cookie-gated.
 */
export function registerDisputes(app: FastifyInstance, deps: GatewayDeps): void {
  const requireAdmin = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const admin = deps.config.adminToken;
    if (!admin || request.headers['x-admin-token'] !== admin) {
      void reply.code(401).send(openAiError('admin token required', 'unauthorized'));
      return false;
    }
    return true;
  };

  // Public: a single job's dispute state (+ the 24h counter-evidence deadline).
  app.get('/v1/disputes/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    if (!HEX32.test(jobId)) {
      return reply.code(400).send(openAiError('invalid job id', 'invalid_request'));
    }
    if (!deps.chain.disputeContract()) {
      return reply
        .code(404)
        .send(openAiError('disputes not enabled on this deployment', 'not_found'));
    }
    const dispute = await deps.chain.getDispute(jobId as Hex);
    if (!dispute) {
      return reply.code(404).send(openAiError('no dispute for this job', 'not_found'));
    }
    return reply.send(dispute);
  });

  // Cookie-gated: the disputes raised against the signed-in operator's node.
  app.get('/v1/operator/disputes', async (request, reply) => {
    let wallet: Address;
    try {
      wallet = requireWalletSession(deps.session, request.cookies[SESSION_COOKIE]);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send(openAiError(err.message, 'invalid_request'));
      }
      throw err;
    }
    if (!deps.chain.disputeContract()) return reply.send({ disputes: [] });
    return reply.send({ disputes: await deps.chain.disputesAgainst(wallet) });
  });

  // Admin: raise a FAST-track dispute and auto-resolve it (challenger/protocol wins → slash).
  app.post('/v1/admin/disputes', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    if (!deps.chain.disputeContract()) {
      return reply
        .code(409)
        .send(openAiError('this deployment has no DisputeResolution contract', 'conflict'));
    }
    const body = request.body as { jobId?: string; defendant?: string } | undefined;
    const jobId = body?.jobId;
    const defendant = body?.defendant;
    if (!jobId || !HEX32.test(jobId)) {
      return reply
        .code(400)
        .send(openAiError('a valid jobId (0x + 64 hex) is required', 'invalid_request'));
    }
    if (!defendant || !ADDR.test(defendant)) {
      return reply
        .code(400)
        .send(openAiError('a valid defendant address is required', 'invalid_request'));
    }
    // Evidence is a content hash referencing the disputed job — the contract stores a hash,
    // never text (privacy). Deterministic so a re-raise maps to the same evidence.
    const evidenceHash = keccak256(jobId as Hex);
    try {
      await deps.chain.ensureDisputeAllowance();
      await deps.chain.raiseDispute(jobId as Hex, defendant as Address, evidenceHash);
      // Admin confirmed the flag → the challenger (the protocol) wins → defendant is slashed.
      await deps.chain.autoResolveDispute(jobId as Hex, true);
    } catch (err) {
      // Surfaces on-chain reverts cleanly (DisputeExists, NotANode, …).
      return sendError(reply, err);
    }
    deps.logger.warn(
      { jobId, defendant },
      'admin raised + auto-resolved a dispute (stake slashed)',
    );
    return reply.send({ jobId, defendant, dispute: await deps.chain.getDispute(jobId as Hex) });
  });
}
