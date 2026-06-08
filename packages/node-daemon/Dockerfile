# QueraIS node daemon image. Build from the REPO ROOT:
#   docker build -f packages/node-daemon/Dockerfile -t querais/node .
#
# Ollama runs as a separate service (see docker-compose.yml); point the daemon at it
# via OLLAMA_URL. The daemon connects OUT to the gateway, so no inbound ports needed.
#
# NOTE: the builder runs the full workspace build, which compiles the Solidity
# contracts (Hardhat downloads solc) — requires network access during `docker build`.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter "./packages/**" build
# Produce a self-contained, production-pruned deploy tree for the daemon.
RUN pnpm --filter @querais/node-daemon deploy --prod /app

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Config via env (see .env.example): NETWORK, RPC_URL, GATEWAY_WS_URL, OLLAMA_URL,
# DAEMON_MODELS, DAEMON_KEYSTORE_PASSWORD, NODE_PRIVATE_KEY (or generated keystore).
CMD ["node", "dist/main.js"]
