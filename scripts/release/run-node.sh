#!/usr/bin/env sh
# QueraIS node launcher (Linux/macOS). Zero-touch: the first run auto-creates your config and
# boots straight into serving — no file editing, no second run. Requires Node >= 22.13; installs
# and starts Ollama if missing. Re-run any time to restart; your wallet + stake persist.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "QueraIS needs Node.js >= 22.13 — install it from https://nodejs.org and re-run." >&2
  exit 1
fi
node -e 'const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`QueraIS needs Node >= 22.13 (found ${process.versions.node})`);
  process.exit(1);
}'

# First run: create .env from the template with working testnet defaults and a freshly generated
# wallet password, then boot immediately. Nothing to edit; nothing to run twice. (Want to
# customize models/stake later? Edit .env and re-run.)
if [ ! -f .env ]; then
  cp .env.example .env
  PW=$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 48 || true)
  [ -z "$PW" ] && PW="$(date +%s)$$"
  if grep -q '^#\{0,1\}[[:space:]]*DAEMON_KEYSTORE_PASSWORD=' .env; then
    sed 's/^#\{0,1\}[[:space:]]*DAEMON_KEYSTORE_PASSWORD=.*/DAEMON_KEYSTORE_PASSWORD='"$PW"'/' .env >.env.tmp && mv .env.tmp .env
  else
    printf 'DAEMON_KEYSTORE_PASSWORD=%s\n' "$PW" >>.env
  fi
  echo ""
  echo "First run — created .env with defaults: testnet gateway, models llama3.2 + gemma3:4b, stake 2500 QAIS."
  echo "Your node wallet is encrypted with a password generated into .env (keep that file private). Starting up..."
  echo ""
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
  curl -fsS http://127.0.0.1:11434/ >/dev/null 2>&1 || {
    echo "Ollama did not start — install it from https://ollama.com, then re-run." >&2
    exit 1
  }
fi

exec node bundle/daemon.mjs
