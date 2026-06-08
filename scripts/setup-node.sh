#!/usr/bin/env bash
# QueraIS node — one-command setup (Linux/macOS, no Docker).
# Usage:  ./scripts/setup-node.sh ws://HOST_IP:8787/node [gemma3:4b]
set -euo pipefail
GATEWAY="${1:-${QUERAIS_GATEWAY:-}}"
MODEL="${2:-gemma3:4b}"
have() { command -v "$1" >/dev/null 2>&1; }

echo "=== QueraIS node setup ==="
have node || { echo "Install Node.js 20+ from https://nodejs.org, then re-run."; exit 1; }
have pnpm || { corepack enable 2>/dev/null || npm install -g pnpm; }
have ollama || { echo "Installing Ollama..."; curl -fsSL https://ollama.com/install.sh | sh; }

[ -n "$GATEWAY" ] || read -rp "Gateway WS URL (e.g. ws://HOST_IP:8787/node): " GATEWAY

echo "Installing dependencies..."; pnpm install
echo "Building...";              pnpm build
echo "Pulling model $MODEL...";  ollama pull "$MODEL"

cat > .env <<EOF
NETWORK=arbitrumSepolia
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
GATEWAY_WS_URL=${GATEWAY}
OLLAMA_URL=http://127.0.0.1:11434
DAEMON_MODELS=${MODEL}
EOF

echo
echo "Setup complete. Start your node with:  ./scripts/start-node.sh"
echo "First run generates a wallet and auto-funds it from the gateway faucet."
