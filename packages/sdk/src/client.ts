import type { ChatMessage } from '@querais/shared';

export interface QueraisClientOptions {
  /** Gateway base URL, e.g. http://127.0.0.1:8787 */
  baseUrl: string;
  /** Bearer API key. */
  apiKey: string;
}

export interface ChatOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** QueraIS routing extensions. */
  maxPricePer1kTokens?: number;
  minReputation?: number;
}

export interface ChatResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  jobId: string | null;
}

export interface NodeInfo {
  wallet: string;
  nodeId: string;
  reputation: number;
  models: Array<{ model: string; pricePerTokenWei: string; tokensPerSecond: number }>;
}

/**
 * A tiny OpenAI-shaped client for the QueraIS gateway. The gateway is itself
 * OpenAI-compatible, so this is convenience sugar (plus QueraIS-specific helpers
 * like nodes()/stats()); the official `openai` SDK also works against the gateway.
 */
export class QueraisClient {
  constructor(private readonly opts: QueraisClientOptions) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` };
  }

  private body(messages: ChatMessage[], opts: ChatOptions, stream: boolean): string {
    return JSON.stringify({
      model: opts.model,
      messages,
      stream,
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxPricePer1kTokens !== undefined
        ? { max_price_per_1k_tokens: opts.maxPricePer1kTokens }
        : {}),
      ...(opts.minReputation !== undefined ? { min_reputation: opts.minReputation } : {}),
    });
  }

  /** Buffered chat completion. */
  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(messages, opts, false),
    });
    if (!res.ok) throw new Error(`QueraIS chat failed: HTTP ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: ChatResult['usage'];
    };
    return {
      content: json.choices[0]?.message.content ?? '',
      usage: json.usage,
      jobId: res.headers.get('x-querais-job-id'),
    };
  }

  /** Streaming chat completion — yields content deltas as they arrive. */
  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(messages, opts, true),
    });
    if (!res.ok || !res.body) {
      throw new Error(`QueraIS chat stream failed: HTTP ${res.status} ${await res.text()}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.replace(/^data: /, '').trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore keep-alives / non-JSON frames */
        }
      }
    }
  }

  async models(): Promise<string[]> {
    const res = await fetch(`${this.opts.baseUrl}/v1/models`, { headers: this.headers() });
    const json = (await res.json()) as { data: Array<{ id: string }> };
    return json.data.map((m) => m.id);
  }

  async nodes(): Promise<NodeInfo[]> {
    const res = await fetch(`${this.opts.baseUrl}/v1/nodes`, { headers: this.headers() });
    const json = (await res.json()) as { data: NodeInfo[] };
    return json.data;
  }

  async stats(): Promise<unknown> {
    const res = await fetch(`${this.opts.baseUrl}/v1/stats`, { headers: this.headers() });
    return res.json();
  }
}
