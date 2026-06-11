import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

/** The public health snapshot. No balances, no wallets, no flag details. */
export interface PublicStatus {
  status: 'ok' | 'degraded' | 'down';
  nodes: number;
  rpcOk: boolean;
  jobs24h: number;
  lastSettlementAgeSeconds: number | null;
  uptimeSeconds: number;
  openIncidents: number;
}

/**
 * Slice 8 status page: GET /v1/status (public JSON, 5 s in-process cache so a
 * status-page poller can't become an RPC amplifier) + GET /status (tiny HTML that
 * polls it). `degraded` is computed, never stored: RPC down, or 0 nodes while the
 * last 24h saw jobs (an empty devnet stays `ok`).
 */
export function registerStatus(app: FastifyInstance, deps: GatewayDeps): void {
  const bootedAt = Date.now();
  let cache: { at: number; body: PublicStatus } | undefined;

  async function compute(): Promise<PublicStatus> {
    const now = Date.now();
    let rpcOk = true;
    try {
      await deps.chain.latestBlockTimestamp();
    } catch {
      rpcOk = false;
    }
    const nodes = deps.pool.size();
    const jobs24h = deps.jobs.countSince(now - 86_400_000);
    const lastSettled = deps.jobs.lastSettledAt();
    const openIncidents = deps.nodeFlags.openCount();
    const degraded = !rpcOk || (nodes === 0 && jobs24h > 0);
    return {
      status: degraded ? 'degraded' : 'ok',
      nodes,
      rpcOk,
      jobs24h,
      lastSettlementAgeSeconds:
        lastSettled === undefined ? null : Math.floor((now - lastSettled) / 1000),
      uptimeSeconds: Math.floor((now - bootedAt) / 1000),
      openIncidents,
    };
  }

  app.get('/v1/status', async (_req, reply) => {
    if (!cache || Date.now() - cache.at > 5_000) {
      cache = { at: Date.now(), body: await compute() };
    }
    return reply.send(cache.body);
  });

  app.get('/status', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(STATUS_HTML);
  });
}

/** Self-contained status page (same no-build-step pattern as the `/` dashboard). */
const STATUS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QueraIS Status</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; background:#0b0f17; color:#d6e1ef;
         display:flex; min-height:100vh; align-items:center; justify-content:center; }
  .card { background:#111726; border:1px solid #1d2738; border-radius:12px; padding:28px 32px; min-width:340px; }
  h1 { font-size:18px; margin:0 0 16px; display:flex; align-items:center; gap:10px; }
  .dot { width:12px; height:12px; border-radius:50%; background:#7d8aa3; }
  .ok .dot { background:#2ec26b; box-shadow:0 0 10px #2ec26b; }
  .degraded .dot { background:#eab308; box-shadow:0 0 10px #eab308; }
  .down .dot { background:#ef4444; box-shadow:0 0 10px #ef4444; }
  .stat { display:flex; justify-content:space-between; gap:24px; padding:5px 0; border-bottom:1px dashed #1d2738; }
  .muted { color:#7d8aa3; }
</style>
</head>
<body>
<div class="card" id="card">
  <h1><span class="dot"></span><span id="state">loading…</span></h1>
  <div class="stat"><span class="muted">connected nodes</span><span id="nodes">—</span></div>
  <div class="stat"><span class="muted">RPC</span><span id="rpc">—</span></div>
  <div class="stat"><span class="muted">jobs (24h)</span><span id="jobs">—</span></div>
  <div class="stat"><span class="muted">last settlement</span><span id="settle">—</span></div>
  <div class="stat"><span class="muted">gateway uptime</span><span id="up">—</span></div>
  <div class="stat"><span class="muted">open incidents</span><span id="inc">—</span></div>
</div>
<script>
  const fmtAge = (s) => s == null ? 'never' : s < 90 ? s + 's ago' : s < 5400 ? Math.round(s/60) + 'm ago' : Math.round(s/3600) + 'h ago';
  const fmtUp = (s) => s < 3600 ? Math.round(s/60) + 'm' : s < 172800 ? Math.round(s/3600) + 'h' : Math.round(s/86400) + 'd';
  async function tick() {
    try {
      const s = await (await fetch('/v1/status')).json();
      document.getElementById('card').className = 'card ' + s.status;
      document.getElementById('state').textContent = s.status;
      document.getElementById('nodes').textContent = s.nodes;
      document.getElementById('rpc').textContent = s.rpcOk ? 'ok' : 'unreachable';
      document.getElementById('jobs').textContent = s.jobs24h;
      document.getElementById('settle').textContent = fmtAge(s.lastSettlementAgeSeconds);
      document.getElementById('up').textContent = fmtUp(s.uptimeSeconds);
      document.getElementById('inc').textContent = s.openIncidents;
    } catch {
      document.getElementById('card').className = 'card down';
      document.getElementById('state').textContent = 'down';
    }
  }
  tick();
  setInterval(tick, 10000);
</script>
</body>
</html>
`;
