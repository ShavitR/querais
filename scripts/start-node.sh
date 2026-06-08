#!/usr/bin/env bash
# QueraIS node — start it (Linux/macOS). Reads .env from setup-node.sh.
set -euo pipefail
echo "Starting QueraIS node..."
pnpm --filter @querais/node-daemon start
