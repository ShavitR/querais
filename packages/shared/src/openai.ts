import { z } from 'zod';

/** Roles QueraIS supports in the MVP chat API. */
export const chatRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * OpenAI-compatible chat completion request, plus QueraIS routing extensions.
 * Unknown fields are passed through (ignored) so existing OpenAI clients work
 * unchanged. `.strip()` would drop extras; we keep the surface forgiving.
 */
export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    max_tokens: z.number().int().positive().max(32_768).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stream: z.boolean().optional(),
    // ── QueraIS extensions (all optional) ──
    /** Max price the requester will pay, in QAIS per 1,000 tokens. */
    max_price_per_1k_tokens: z.number().positive().optional(),
    /** Minimum node reputation in [0,1]. */
    min_reputation: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export type FinishReason = 'stop' | 'length' | 'content_filter' | null;

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: FinishReason;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: ChatRole; content?: string };
    finish_reason: FinishReason;
  }>;
}

/** Build a non-streaming chat completion response from a finished generation. */
export function buildChatCompletion(params: {
  id: string;
  created: number;
  model: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: FinishReason;
}): ChatCompletionResponse {
  return {
    id: params.id,
    object: 'chat.completion',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: params.content },
        finish_reason: params.finishReason,
      },
    ],
    usage: {
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.promptTokens + params.completionTokens,
    },
  };
}

/** Build a single streaming chunk carrying a content delta. */
export function buildChunk(params: {
  id: string;
  created: number;
  model: string;
  content?: string;
  role?: ChatRole;
  finishReason?: FinishReason;
}): ChatCompletionChunk {
  return {
    id: params.id,
    object: 'chat.completion.chunk',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        delta: {
          ...(params.role ? { role: params.role } : {}),
          ...(params.content !== undefined ? { content: params.content } : {}),
        },
        finish_reason: params.finishReason ?? null,
      },
    ],
  };
}

export interface ModelListResponse {
  object: 'list';
  data: Array<{ id: string; object: 'model'; owned_by: string }>;
}
