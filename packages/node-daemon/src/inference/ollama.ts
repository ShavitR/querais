import type {
  FinishReason,
  InferenceBackend,
  InferenceChunk,
  InferenceRequest,
  InferenceResult,
} from './backend.js';

interface OllamaStreamLine {
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Real local inference via Ollama's /api/chat (streaming NDJSON). Token counts come
 * straight from Ollama's `eval_count` / `prompt_eval_count`, so the daemon reports
 * genuine model token usage rather than an estimate.
 */
export class OllamaBackend implements InferenceBackend {
  readonly name = 'ollama';
  constructor(private readonly baseUrl: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  }

  async generate(
    req: InferenceRequest,
    onChunk: (chunk: InferenceChunk) => void,
  ): Promise<InferenceResult> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        // qwen3-style thinking models otherwise emit long hidden reasoning.
        think: false,
        options: {
          temperature: req.temperature,
          num_predict: req.maxTokens,
        },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/chat failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: FinishReason = 'stop';

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const obj = JSON.parse(trimmed) as OllamaStreamLine;
      const delta = obj.message?.content ?? '';
      if (delta) {
        content += delta;
        onChunk({ content: delta });
      }
      if (obj.done) {
        promptTokens = obj.prompt_eval_count ?? promptTokens;
        completionTokens = obj.eval_count ?? completionTokens;
        finishReason = obj.done_reason === 'length' ? 'length' : 'stop';
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) handleLine(buffer);

    return { content, promptTokens, completionTokens, finishReason };
  }
}
