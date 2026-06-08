# QueraIS gateway image. Build from the REPO ROOT:
#   docker build -f packages/gateway/Dockerfile -t querais/gateway .
#
# Run with NETWORK=arbitrumSepolia and the gateway hot-wallet keys as secrets (never
# bake them in). Put TLS + a domain in front (reverse proxy) for a public deployment.
#
# NOTE: the builder compiles the Solidity contracts (Hardhat downloads solc) — requires
# network access during `docker build`.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter "./packages/**" build
RUN pnpm --filter @querais/gateway deploy --prod /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV GATEWAY_PORT=8787
COPY --from=build /app /app
EXPOSE 8787
# Config via env/secrets: NETWORK, RPC_URL, GATEWAY_PRIVATE_KEY, GATEWAY_ADMIN_TOKEN,
# GATEWAY_FAUCET_PRIVATE_KEY, GATEWAY_API_KEY_STORE, GATEWAY_RATE_LIMIT_MAX.
CMD ["node", "dist/main.js"]
