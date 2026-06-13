import type { FastifyInstance } from 'fastify';
import type { Hex } from 'viem';
import { AuthError } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { resolveRequesterOrSession } from '../auth.js';
import { SESSION_COOKIE } from '../session.js';
import { openAiError } from '../http.js';

const STATUS_NAMES = [
  'none',
  'pending',
  'assigned',
  'completed',
  'verified',
  'failed',
  'cancelled',
] as const;

/**
 * Job routes:
 *  - GET /v1/jobs      → the authed requester's recent jobs (cookie or Bearer), from the DB
 *                        mirror — the Slice 10B jobs explorer list.
 *  - GET /v1/jobs/:id  → a job's on-chain status (the escrow is the registry), enriched with
 *                        the persisted record (model, settlement split, timestamps).
 * The chain stays authoritative for status/existence; the DB only adds off-chain metadata.
 */
export function registerJobs(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/jobs', async (request, reply) => {
    let requester;
    try {
      requester = resolveRequesterOrSession(
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
    const { limit } = request.query as { limit?: string };
    const rows = deps.jobs.listForRequester(requester, limit ? Number(limit) : 50);
    return {
      object: 'list',
      data: rows.map((r) => ({
        jobId: r.jobId,
        status: r.status,
        model: r.model,
        provider: r.provider,
        maxTokens: r.maxTokens,
        actualTokens: r.actualTokens,
        agreedPricePerToken: r.agreedPriceWei,
        providerPay: r.providerPayWei,
        protocolFee: r.feeWei,
        failureReason: r.reason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });

  app.get('/v1/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
      return reply.code(400).send(openAiError('invalid job id', 'invalid_request'));
    }
    const job = await deps.chain.getJob(id as Hex);
    if (job.status === 0) {
      return reply.code(404).send(openAiError('job not found', 'not_found'));
    }
    const record = deps.jobs.get(id as Hex);
    return {
      jobId: id,
      status: STATUS_NAMES[job.status] ?? 'unknown',
      requester: job.requester,
      provider: job.provider,
      lockedAmount: job.lockedAmount.toString(),
      agreedPricePerToken: job.agreedPricePerToken.toString(),
      maxTokens: Number(job.maxTokens),
      actualTokens: Number(job.actualTokens),
      deadline: Number(job.deadline),
      resultHash: job.resultHash,
      // Off-chain metadata (null if the row predates persistence or the DB was reset).
      model: record?.model ?? null,
      providerPay: record?.providerPayWei ?? null,
      protocolFee: record?.feeWei ?? null,
      failureReason: record?.reason ?? null,
      createdAt: record?.createdAt ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  });
}
