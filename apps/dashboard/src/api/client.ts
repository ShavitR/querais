/**
 * Typed client over the gateway's `/v1/*` routes. Same-origin (the gateway serves this
 * app), so URLs are relative and the session cookie rides automatically; `credentials:
 * 'include'` is explicit for clarity and for the standalone dev-server proxy case.
 */
import type {
  AdminFlagsResponse,
  CreditInfo,
  DisputeView,
  JobsResponse,
  Me,
  ModelsResponse,
  NodeFlag,
  NodesResponse,
  OperatorOverview,
  SessionStatus,
  SignedCapWire,
  Stats,
  Status,
  Usage,
} from './types';

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
export const getModels = (): Promise<ModelsResponse> => request<ModelsResponse>('/v1/models');
export const getCreditInfo = (): Promise<CreditInfo> => request<CreditInfo>('/v1/credit/info');

// --- Authenticated (session cookie) ---
export const getUsage = (): Promise<Usage> => request<Usage>('/v1/usage');
export const getJobs = (): Promise<JobsResponse> => request<JobsResponse>('/v1/jobs');
export const getSession = (): Promise<SessionStatus> => request<SessionStatus>('/v1/sessions');

// --- Slice 10C: operator console (cookie) + admin review queue (x-admin-token) ---
export const getOperatorOverview = (): Promise<OperatorOverview> =>
  request<OperatorOverview>('/v1/operator/overview');

export const getAdminFlags = (
  adminToken: string,
  status: 'open' | 'all' = 'open',
): Promise<AdminFlagsResponse> =>
  request<AdminFlagsResponse>(`/v1/admin/flags?status=${status}`, {
    headers: { 'x-admin-token': adminToken },
  });

export const reviewFlag = (
  adminToken: string,
  id: number,
  by: string,
  note?: string,
): Promise<{ flag: NodeFlag }> =>
  request<{ flag: NodeFlag }>(`/v1/admin/flags/${id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ by, note }),
  });

// --- Slice 10C-2: disputes (read public; the admin raise is MONEY-MOVING) ---
export const getOperatorDisputes = (): Promise<{ disputes: DisputeView[] }> =>
  request<{ disputes: DisputeView[] }>('/v1/operator/disputes');

export const raiseDispute = (
  adminToken: string,
  jobId: string,
  defendant: string,
): Promise<{ jobId: string; dispute: DisputeView | null }> =>
  request<{ jobId: string; dispute: DisputeView | null }>('/v1/admin/disputes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ jobId, defendant }),
  });

/** Register a browser-signed EIP-712 spending cap (10B-2). */
export const postSession = (cap: SignedCapWire): Promise<unknown> =>
  request<unknown>('/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cap),
  });

/**
 * Stream a chat completion over SSE, invoking `onDelta` for each content chunk. Auth is the
 * session cookie (same-origin). Surfaces the gateway's in-band SSE error frame
 * (HTTP-200-with-`{error}`) as a throw, matching the SDK's behavior.
 */
export async function streamChat(
  body: { model: string; messages: { role: string; content: string }[]; max_tokens?: number },
  onDelta: (chunk: string) => void,
): Promise<void> {
  const res = await fetch('/v1/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { error?: { message?: string } };
      if (b.error?.message) message = b.error.message;
    } catch {
      /* keep status line */
    }
    throw new ApiError(res.status, message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const payload = frame.replace(/^data: /, '').trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: {
        error?: { message?: string };
        choices?: { delta?: { content?: string } }[];
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // ignore non-JSON keepalives
      }
      if (parsed.error?.message) throw new ApiError(200, parsed.error.message);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }
  }
}

// --- Auth lifecycle ---
export const signInWithKey = (apiKey: string): Promise<Me> =>
  request<Me>('/v1/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

/** EIP-4361 wallet sign-in (10B-2): fetch a nonce, then exchange a signed SIWE message. */
export const getSiweNonce = (): Promise<{ nonce: string }> =>
  request<{ nonce: string }>('/v1/auth/nonce', { method: 'POST' });

export const signInWithWallet = (message: string, signature: string): Promise<Me> =>
  request<Me>('/v1/auth/wallet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature }),
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
