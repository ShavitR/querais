#!/usr/bin/env sh
# QueraIS node launcher (Linux/macOS). Requires Node >= 22.13; installs + starts Ollama if missing.
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

# Ensure Ollama is installed + running. The daemon talks to it over HTTP (OLLAMA_URL) and
# auto-pulls the configured model; without it the daemon exits with "backend unavailable".
if ! curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama not found — installing from https://ollama.com ..."
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &)
  echo "Waiting for Ollama to start..."
  i=0
  while ! curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1 && [ "$i" -lt 30 ]; do sleep 2; i=$((i + 1)); done
  curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1 || { echo "Ollama did not start — install it from https://ollama.com, then re-run." >&2; exit 1; }
fi

exec node bundle/daemon.mjs
