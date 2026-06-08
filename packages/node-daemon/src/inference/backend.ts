/**
 * Inference backend abstraction. The MVP ships an Ollama backend (real local
 * inference) and a deterministic Mock backend (tests). llama.cpp / vLLM can be
 * added later behind this same interface — it is the seam the rest of the daemon
 * depends on, so nothing above the backend knows which engine ran the job.
 */

export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceRequest {
  /** Backend-native model id (already resolved from the requested model name). */
  model: string;
  messages: InferenceMessage[];
  maxTokens: number;
  temperature: number;
}

/** A streamed token delta. */
export interface InferenceChunk {
  content: string;
}

export type FinishReason = 'stop' | 'length' | 'error';

export interface InferenceResult {
  /** The full generated text (concatenation of all chunk contents). */
  content: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: FinishReason;
}

export interface InferenceBackend {
  readonly name: string;
  /** Is the backend reachable / usable right now? */
  isAvailable(): Promise<boolean>;
  /** Backend-native model ids currently ready to serve. */
  listModels(): Promise<string[]>;
  /** Ensure a model is downloaded/ready before serving (e.g. `ollama pull`). Optional. */
  ensureModel?(model: string): Promise<void>;
  /**
   * Stream a generation. `onChunk` is called for each token delta; the promise
   * resolves with the final result (full text + authoritative token counts).
   */
  generate(
    req: InferenceRequest,
    onChunk: (chunk: InferenceChunk) => void,
  ): Promise<InferenceResult>;
}
