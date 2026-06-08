import type { FastifyInstance } from 'fastify';
import type { Hex } from 'viem';
import type { GatewayDeps } from '../deps.js';
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

/** GET /v1/jobs/:id — read a job's on-chain status (the escrow is the registry). */
export function registerJobs(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
      return reply.code(400).send(openAiError('invalid job id', 'invalid_request'));
    }
    const job = await deps.chain.getJob(id as Hex);
    if (job.status === 0) {
      return reply.code(404).send(openAiError('job not found', 'not_found'));
    }
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
    };
  });
}
