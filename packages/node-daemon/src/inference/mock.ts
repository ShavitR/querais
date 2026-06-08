import type {
  FinishReason,
  InferenceBackend,
  InferenceChunk,
  InferenceRequest,
  InferenceResult,
} from './backend.js';

/**
 * Deterministic backend for tests: echoes the last user message as a fixed reply,
 * streamed word-by-word. Token counts are word counts, so assertions are exact and
 * no model/Ollama is required.
 */
export class MockBackend implements InferenceBackend {
  readonly name = 'mock';
  constructor(private readonly models: string[] = ['mock-model']) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async generate(
    req: InferenceRequest,
    onChunk: (chunk: InferenceChunk) => void,
  ): Promise<InferenceResult> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content ?? '';
    const promptTokens = countWords(prompt);

    const words = countWordsArray(`You said: ${prompt}`);
    const limited = words.slice(0, req.maxTokens);
    const finishReason: FinishReason = words.length > req.maxTokens ? 'length' : 'stop';

    let content = '';
    limited.forEach((word, i) => {
      const piece = (i === 0 ? '' : ' ') + word;
      content += piece;
      onChunk({ content: piece });
    });

    return { content, promptTokens, completionTokens: limited.length, finishReason };
  }
}

function countWordsArray(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
function countWords(text: string): number {
  return countWordsArray(text).length;
}
