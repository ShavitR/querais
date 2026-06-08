#!/usr/bin/env bash
# QueraIS node installer (Linux/macOS). Requires Docker. Prompts for the public gateway,
# writes node.env, and starts Ollama + the node daemon via docker compose.
set -euo pipefail

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required: https://docs.docker.com/get-docker/" >&2
  exit 1
}

read -rp "Public gateway WS URL (e.g. wss://gateway.example/node): " GATEWAY_WS_URL
read -rp "Models to serve [gemma3:4b]: " DAEMON_MODELS
DAEMON_MODELS=${DAEMON_MODELS:-gemma3:4b}
read -rsp "Keystore password (encrypts your node wallet): " DAEMON_KEYSTORE_PASSWORD
echo

cat > node.env <<EOF
NETWORK=arbitrumSepolia
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
GATEWAY_WS_URL=${GATEWAY_WS_URL}
DAEMON_MODELS=${DAEMON_MODELS}
DAEMON_KEYSTORE_PASSWORD=${DAEMON_KEYSTORE_PASSWORD}
EOF

echo "Starting Ollama + node daemon…"
docker compose --env-file node.env up -d --build

echo
echo "Node started. Next steps:"
echo "  1. Find your node wallet address:  docker compose logs node | grep 'node ready on-chain'"
echo "  2. Fund it with a little Arbitrum Sepolia ETH (gas) and QAIS (stake) — use the faucet."
echo "  3. The node auto-registers and joins the marketplace."
