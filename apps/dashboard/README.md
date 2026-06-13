# @querais/dashboard

The QueraIS web app — **Vite + React + TypeScript**, served by the gateway at `/` from this
package's built `dist/`. Slice 10A is the foundation (app shell, API-key sign-in, a read-only
network overview); 10B–10D add the requester console, operator/admin console, and the live
explorer. The SEO/marketing site is a separate Next.js app (10E).

## Develop

```bash
# 1. run a gateway locally (from the repo root)
pnpm dev:gateway

# 2. run the app's dev server (proxies /v1, /health, /status to the gateway on :8787)
pnpm --filter @querais/dashboard dev    # http://localhost:5173
```

## Build

```bash
pnpm --filter @querais/dashboard build   # → apps/dashboard/dist
```

`pnpm build` (repo root) builds this after the workspace packages. The gateway serves
`apps/dashboard/dist` at `/` (override the location with `GATEWAY_DASHBOARD_DIR`); if the
directory is absent the gateway still boots and serves a minimal fallback page — the app is
cosmetic, the gateway is the money path.

## Boundaries

- **Same-origin only.** The app uses relative `/v1/...` URLs; there is no CORS surface.
- **No secrets in the browser.** Sign-in posts an API key once; the gateway mints an httpOnly
  session cookie. The key is never stored client-side.
- **Privacy.** The UI shows hashes/scores, never prompt or output text.
