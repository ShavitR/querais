export * from './backend.js';
export { OllamaBackend } from './ollama.js';
export { MockBackend, mockModelDigest } from './mock.js';

/**
 * Optional friendly aliases mapping requested model names to local Ollama tags.
 * Anything not listed is used as-is (the daemon advertises its real Ollama tags,
 * so requesters normally ask for those directly).
 */
const MODEL_ALIASES: Record<string, string> = {
  // OpenAI/HF-style names → local Ollama tags (operators can serve these).
  'meta-llama/Llama-3-8B-Instruct': 'llama3:8b',
  'mistralai/Mistral-7B-Instruct': 'mistral:7b',
  'llama3-8b': 'llama3:8b',
  'mistral-7b': 'mistral:7b',
  'qwen3-1.7b': 'qwen3:1.7b',
  'gemma3-4b': 'gemma3:4b',
};

export function resolveModel(requested: string): string {
  return MODEL_ALIASES[requested] ?? requested;
}
