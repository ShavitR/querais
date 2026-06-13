import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { GatewayDeps } from '../deps.js';
import { openAiError } from '../http.js';
import { TERMS_URL, PRIVACY_URL } from './keys.js';

/**
 * Slice 10A — serve the built web app (`apps/dashboard/dist`) at `/`, replacing the inline
 * HTML dashboard. Same-origin, so the app calls `/v1/*` with no CORS.
 *
 * Design rule (HANDOFF §6): the gateway is the money path, the app is cosmetic. If the
 * built app is absent (a gateway-only build, or the image shipped without it), the gateway
 * still boots and serves a minimal fallback page — it must never 500 over a missing UI.
 *
 * SPA routing: real asset files are served directly; any other browser GET (Accept: html,
 * non-API path) falls back to `index.html` so client-side routes deep-link. Everything else
 * (unknown `/v1/*`, non-GET, non-HTML) keeps the OpenAI-style JSON 404.
 */
const INFRA_PREFIXES = ['/v1', '/node', '/health', '/ready', '/metrics', '/status'];

function isApiPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? url;
  return INFRA_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  );
}

/** Resolve the app's built dist dir: explicit config, else walk up to `apps/dashboard/dist`. */
function resolveDashboardDir(configured: string | undefined): string | undefined {
  if (configured) return existsSync(join(configured, 'index.html')) ? configured : undefined;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'apps', 'dashboard', 'dist');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export async function registerStaticApp(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
  const dir = resolveDashboardDir(deps.config.dashboardDir);

  if (!dir) {
    // Boot-safe fallback — the app isn't built; the gateway runs unaffected.
    deps.logger.warn('web app not found (apps/dashboard/dist) — serving fallback page at /');
    app.get('/', async (_req, reply) => {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(fallbackHtml());
    });
    return;
  }

  deps.logger.info({ dir }, 'serving web app at /');
  // wildcard:false → static serves real files (index.html at /, hashed assets); misses fall
  // through to the notFound handler, which does the SPA fallback.
  await app.register(fastifyStatic, { root: dir, prefix: '/', wildcard: false });

  app.setNotFoundHandler((request, reply) => {
    const accept = request.headers.accept ?? '';
    if (request.method === 'GET' && !isApiPath(request.url) && accept.includes('text/html')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(openAiError('not found', 'not_found'));
  });
}

function fallbackHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>QueraIS</title>
<style>body{margin:0;font:14px/1.6 ui-monospace,Menlo,monospace;background:#0b0f17;color:#d6e1ef;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:560px;padding:24px}a{color:#7d8aa3}</style>
</head><body><main>
<h1>QueraIS gateway</h1>
<p class="muted">The web app isn't built in this deployment. The API is fully up:
<code>/v1/*</code>, <code>/health</code>, <code>/metrics</code>, <code>/status</code>.</p>
<p>Build it with <code>pnpm --filter @querais/dashboard build</code>, or set
<code>GATEWAY_DASHBOARD_DIR</code>.</p>
<p>testnet — tokens have no value · <a href="${TERMS_URL}">terms</a> · <a href="${PRIVACY_URL}">privacy</a></p>
</main></body></html>`;
}
