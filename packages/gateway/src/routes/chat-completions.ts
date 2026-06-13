import type { FastifyInstance } from 'fastify';
import {
  AuthError,
  buildChatCompletion,
  buildChunk,
  chatCompletionRequestSchema,
} from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { resolveRequester } from '../auth.js';
import { SESSION_COOKIE } from '../session.js';
import { validatePromptLimits, type QuotaVerdict } from '../quota.js';
import { openAiError, randomId, sendError, sseData } from '../http.js';

/**
 * POST /v1/chat/completions — the OpenAI-compatible entrypoint. Supports both
 * buffered and streaming (SSE) responses. Auth via Bearer API key (SDK/CLI) OR the web-app
 * session cookie (Slice 10B playground); Bearer wins. Slice 3: per-key daily quotas (429 +
 * x-querais-quota-* headers) and prompt-abuse limits run before any matching or chain interaction.
 */
export function registerChatCompletions(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/v1/chat/completions', async (request, reply) => {
    // Resolve the requester + the quota tier from either credential. Bearer carries the key
    // (tier from the key store); the cookie carries the tier in its claims (no key to look up).
    let requester;
    let quota: QuotaVerdict;
    const auth = request.headers.authorization;
    if (auth) {
      try {
        requester = resolveRequester(deps.keyStore, auth);
      } catch (err) {
        return sendError(reply, err);
      }
      const apiKey = auth.replace(/^Bearer\s+/i, '').trim();
      quota = deps.quota.check(apiKey, requester);
    } else {
      const claims = deps.session.verify(request.cookies[SESSION_COOKIE]);
      if (!claims) return sendError(reply, new AuthError('Missing Authorization header'));
      requester = claims.wallet;
      quota = deps.quota.checkWithTier(claims.tier, requester);
    }

    reply.header('x-querais-quota-tier', quota.tier);
    reply.header('x-querais-quota-remaining-jobs', String(quota.remainingJobs));
    reply.header('x-querais-quota-remaining-tokens', String(quota.remainingTokens));
    if (!quota.ok) {
      reply.header('x-querais-quota-limit-jobs', String(quota.limitJobs));
      reply.header('x-querais-quota-limit-tokens', String(quota.limitTokens));
      return reply
        .code(429)
        .send(openAiError('daily quota exceeded for this API key', 'quota_exceeded'));
    }

    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(openAiError(parsed.error.message, 'invalid_request'));
    }
    const req = parsed.data;

    // Prompt-abuse limits — refuse before touching matching or the chain.
    const refusal = validatePromptLimits(req, deps.hardening);
    if (refusal) {
      return reply.code(400).send(openAiError(refusal, 'invalid_request'));
    }
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
