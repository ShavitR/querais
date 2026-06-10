import { buildSignedSession, type ChatMessage } from '@querais/shared';

export interface QueraisClientOptions {
  /** Gateway base URL, e.g. http://127.0.0.1:8787 */
  baseUrl: string;
  /** Bearer API key. */
  apiKey: string;
  /** Optional requester private key — only needed to open a batched-settlement session. */
  privateKey?: `0x${string}`;
}

/** What the gateway needs you to know to sign a spending cap (`GET /v1/credit/info`). */
export interface CreditInfo {
  chainId: number;
  creditAccount: `0x${string}`;
  token: `0x${string}`;
  settler: `0x${string}`;
}

export interface OpenSessionOptions {
  /** Cumulative ceiling the gateway may settle against this session (wei). */
  maxSpendWei: bigint;
  /** Session nonce (namespaces independent caps for the same requester). */
  nonce: bigint;
  /** Unix-seconds expiry; the gateway/contract reject the cap after this. */
  deadline: bigint;
}

/** GET /v1/sessions — live session/credit/headroom view. Wei as decimal strings. */
export interface SessionStatus {
  requester: `0x${string}`;
  settler: `0x${string}`;
  session: {
    nonce: string;
    maxSpendWei: string;
    deadline: string;
    spentAgainstWei: string;
    capRemainingWei: string;
  } | null;
  credit: { balanceWei: string };
  pendingDebits: { count: number; totalWei: string };
  headroomWei: string | null;
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

  /** Fetch the data needed to build + sign a spending cap (chainId, contract, settler). */
  async creditInfo(): Promise<CreditInfo> {
    const res = await fetch(`${this.opts.baseUrl}/v1/credit/info`, { headers: this.headers() });
    if (!res.ok) throw new Error(`QueraIS credit info failed: HTTP ${res.status}`);
    return (await res.json()) as CreditInfo;
  }

  /**
   * Open a batched-settlement session: sign an EIP-712 spending cap with the client's
   * private key (signed once, off-chain, zero gas) and register it with the gateway. After
   * this, jobs from this key settle in batches — no per-call wallet tx. Requires `privateKey`
   * in the client options and a CreditAccount deposit already in place.
   */
  async openSession(opts: OpenSessionOptions): Promise<{ ok: boolean; nonce: string }> {
    if (!this.opts.privateKey) throw new Error('openSession requires a privateKey in client opts');
    const info = await this.creditInfo();
    const wire = await buildSignedSession(this.opts.privateKey, {
      maxSpendWei: opts.maxSpendWei,
      nonce: opts.nonce,
      deadline: opts.deadline,
      settler: info.settler,
      chainId: info.chainId,
      verifyingContract: info.creditAccount,
    });
    const res = await fetch(`${this.opts.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(wire),
    });
    if (!res.ok) {
      throw new Error(`QueraIS openSession failed: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { ok: boolean; nonce: string };
  }

  /**
   * The requester's live session status: active cap (if any), on-chain spend against it,
   * credit balance, unflushed debits, and `headroomWei` — the largest worst-case job cost
   * the gateway would still accept right now (null without an active session).
   */
  async sessionStatus(): Promise<SessionStatus> {
    const res = await fetch(`${this.opts.baseUrl}/v1/sessions`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`QueraIS sessionStatus failed: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as SessionStatus;
  }
}
