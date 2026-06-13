/**
 * Typed client over the gateway's `/v1/*` routes. Same-origin (the gateway serves this
 * app), so URLs are relative and the session cookie rides automatically; `credentials:
 * 'include'` is explicit for clarity and for the standalone dev-server proxy case.
 */
import type { Me, NodesResponse, Stats, Status, Usage } from './types';

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    // Gateway errors are the OpenAI-style `{ error: { message } }` envelope.
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON body — keep the status line */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// --- Public (no auth) ---
export const getStats = (): Promise<Stats> => request<Stats>('/v1/stats');
export const getNodes = (): Promise<NodesResponse> => request<NodesResponse>('/v1/nodes');
export const getStatus = (): Promise<Status> => request<Status>('/v1/status');

// --- Authenticated (session cookie) ---
export const getUsage = (): Promise<Usage> => request<Usage>('/v1/usage');

// --- Auth lifecycle ---
export const signInWithKey = (apiKey: string): Promise<Me> =>
  request<Me>('/v1/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

/** GET /v1/auth/me — resolves the cookie, or `null` when not signed in (401). */
export async function getMe(): Promise<Me | null> {
  try {
    return await request<Me>('/v1/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const signOut = (): Promise<unknown> =>
  request<unknown>('/v1/auth/logout', { method: 'POST' });

export { ApiError };
