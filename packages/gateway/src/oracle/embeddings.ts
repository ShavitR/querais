/**
 * Embedding seam for Layer-A semantic verification (Slice 5). The sampler compares a
 * provider's output to oracle re-runs by embedding cosine similarity — NEVER by hash
 * (temp=0 is not deterministic across hardware/backends; HANDOFF §6).
 */
export interface EmbeddingProvider {
  /** Embed a text into a fixed-dimension vector. */
  embed(text: string): Promise<number[]>;
}

/** Cosine similarity in [-1, 1]; 0 when either vector is zero or lengths mismatch. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Ollama-backed embeddings (`POST /api/embeddings`). The production default; tests and
 * e2e inject a deterministic provider through the same seam instead.
 */
export class OllamaEmbeddings implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string = 'nomic-embed-text',
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`embeddings request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
      throw new Error('embeddings response missing vector');
    }
    return body.embedding;
  }
}
