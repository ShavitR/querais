/**
 * @querais/sdk — a tiny OpenAI-shaped TypeScript client + `querais` CLI.
 *
 * The QueraIS gateway is OpenAI-compatible, so the official `openai` SDK works
 * against it directly (see the e2e parity test). This client adds convenience plus
 * QueraIS-specific helpers (nodes(), stats()).
 */
export const SDK_VERSION = '0.2.1';

export {
  QueraisClient,
  type QueraisClientOptions,
  type ChatOptions,
  type ChatResult,
  type NodeInfo,
  type SessionStatus,
} from './client.js';
