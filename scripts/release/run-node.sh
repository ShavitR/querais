#!/usr/bin/env sh
# QueraIS node launcher (Linux/macOS). Requires Node >= 22.13 and Ollama.
# First run: copies .env.example -> .env and stops so you can edit it.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "QueraIS needs Node.js >= 22.13 — install it from https://nodejs.org" >&2
  exit 1
fi
node -e 'const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`QueraIS needs Node >= 22.13 (found ${process.versions.node})`);
  process.exit(1);
}'

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit it (models, stake), then run me again."
  exit 1
fi

exec node bundle/daemon.mjs
