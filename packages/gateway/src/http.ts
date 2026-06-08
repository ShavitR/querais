import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { QueraisError } from '@querais/shared';

/** OpenAI-style error envelope. */
export function openAiError(message: string, type: string, code: string | null = null) {
  return { error: { message, type, code } };
}

/** Map an error to an OpenAI-style HTTP response (QueraisError carries status+code). */
export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof QueraisError) {
    return reply.code(err.status).send(openAiError(err.message, err.code));
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return reply.code(500).send(openAiError(message, 'internal_error'));
}

/** Format a Server-Sent-Events data frame. */
export function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function randomId(): string {
  return randomBytes(12).toString('hex');
}
