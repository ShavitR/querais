import type { FastifyInstance } from 'fastify';
import { buildChatCompletion, buildChunk, chatCompletionRequestSchema } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { resolveRequester } from '../auth.js';
import { openAiError, randomId, sendError, sseData } from '../http.js';

/**
 * POST /v1/chat/completions — the OpenAI-compatible entrypoint. Supports both
 * buffered and streaming (SSE) responses. Auth via Bearer API key → requester wallet.
 */
export function registerChatCompletions(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/v1/chat/completions', async (request, reply) => {
    let requester;
    try {
      requester = resolveRequester(deps.config.apiKeys, request.headers.authorization);
    } catch (err) {
      return sendError(reply, err);
    }

    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(openAiError(parsed.error.message, 'invalid_request'));
    }
    const req = parsed.data;
    const id = `chatcmpl-${randomId()}`;
    const created = Math.floor(Date.now() / 1000);

    if (req.stream) {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(sseData(buildChunk({ id, created, model: req.model, role: 'assistant' })));
      try {
        const result = await deps.dispatcher.dispatch(req, requester, (delta) => {
          res.write(sseData(buildChunk({ id, created, model: req.model, content: delta })));
        });
        res.write(
          sseData(buildChunk({ id, created, model: req.model, finishReason: result.finishReason })),
        );
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        deps.logger.error({ err: String(err) }, 'streaming dispatch failed');
        const message = err instanceof Error ? err.message : 'internal error';
        res.write(sseData(openAiError(message, 'dispatch_error')));
        res.end();
      }
      return reply;
    }

    try {
      const result = await deps.dispatcher.dispatch(req, requester);
      reply.header('x-querais-job-id', result.jobId);
      return reply.code(200).send(
        buildChatCompletion({
          id,
          created,
          model: result.model,
          content: result.content,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          finishReason: result.finishReason,
        }),
      );
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
