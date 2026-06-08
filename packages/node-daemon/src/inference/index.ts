export * from './backend.js';
export { OllamaBackend } from './ollama.js';
export { MockBackend } from './mock.js';

/**
 * Optional friendly aliases mapping requested model names to local Ollama tags.
 * Anything not listed is used as-is (the daemon advertises its real Ollama tags,
 * so requesters normally ask for those directly).
 */
const MODEL_ALIASES: Record<string, string> = {
  'meta-llama/Llama-3-8B-Instruct': 'gemma3:4b',
  'mistralai/Mistral-7B-Instruct': 'gemma3:4b',
};

export function resolveModel(requested: string): string {
  return MODEL_ALIASES[requested] ?? requested;
}
