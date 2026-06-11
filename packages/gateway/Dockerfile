# QueraIS gateway image. Build from the REPO ROOT:
#   docker build -f packages/gateway/Dockerfile -t querais/gateway .
#
# Run with NETWORK=arbitrumSepolia and the gateway hot-wallet keys as secrets (never
# bake them in). Put TLS + a domain in front (reverse proxy) for a public deployment.
#
# OPERATIONAL CONSTRAINT (Slice 7): run EXACTLY ONE instance. node:sqlite is
# single-writer, and the flush / reputation-snapshot / Layer-A / pattern / dispute /
# treasury / rewards timers all assume a single owner — two instances would double-
# publish reputation and double-raise disputes. Mount a persistent volume at the
# GATEWAY_DB_PATH directory and back it up continuously (runbook §9). Horizontal scale
# is deferred (P3.6).
#
# NOTE: the builder compiles the Solidity contracts (Hardhat downloads solc) — requires
# network access during `docker build`.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter "./packages/**" build
# --legacy: pnpm v10+ requires inject-workspace-packages=true for `deploy`; we keep
# the workspace symlink layout and use the legacy copy behavior instead.
RUN pnpm --filter @querais/gateway deploy --legacy --prod /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV GATEWAY_PORT=8787
COPY --from=build /app /app
# Drop root: the runtime never needs it, and a compromised gateway should not own its
# own filesystem. `node` is a built-in non-root user in the official image. The DB
# volume must be writable by uid 1000 (node).
USER node
EXPOSE 8787
# Liveness probe. The platform's READINESS probe should hit /ready instead, which also
# checks the RPC + DB (server.ts). node is PID 1 here, so it receives SIGTERM directly
# and drains pending debits via the handler in main.ts before exit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GATEWAY_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Config via env/secrets: NETWORK, RPC_URL, GATEWAY_PRIVATE_KEY, GATEWAY_ADMIN_TOKEN,
# GATEWAY_FAUCET_PRIVATE_KEY, GATEWAY_API_KEYS, GATEWAY_RATE_LIMIT_MAX, GATEWAY_DB_PATH
# (point at the mounted volume), GATEWAY_SHUTDOWN_GRACE_MS.
CMD ["node", "dist/main.js"]
