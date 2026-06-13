#!/usr/bin/env sh
# QueraIS node — one-line installer (Linux/macOS).
#
#   curl -fsSL https://querais.xyz/install.sh | sh
#
# Installs Node.js if missing (Homebrew on macOS), downloads + checksum-verifies the latest node
# release from GitHub, pre-creates a working config, and starts your node (which installs/starts
# Ollama itself). Testnet — no real value. Your wallet stays on this machine.
set -e
REPO="ShavitR/querais"
DIR="$HOME/querais-node"

say() { printf '==> %s\n' "$1"; }
die() {
  printf 'x %s\n' "$1" >&2
  exit 1
}

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a<22||(a===22&&b<13)?1:0)' 2>/dev/null
}

# 1. Node >= 22.13
if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    say 'Installing Node.js (Homebrew)...'
    brew install node || true
  fi
fi
node_ok || die 'Node >= 22.13 is required. Install it from https://nodejs.org and re-run.'
command -v curl >/dev/null 2>&1 || die 'curl is required.'
command -v tar >/dev/null 2>&1 || die 'tar is required.'

# 2. Resolve the latest release's node bundle + checksums
say 'Finding the latest node release...'
JSON=$(curl -fsSL -H 'User-Agent: querais-installer' "https://api.github.com/repos/$REPO/releases/latest")
TAR_URL=$(printf '%s' "$JSON" | grep -o '"browser_download_url"[^,]*querais-node-[^"]*\.tar\.gz"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')
SUM_URL=$(printf '%s' "$JSON" | grep -o '"browser_download_url"[^,]*SHA256SUMS"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$TAR_URL" ] || die "No node bundle in the latest release - see https://github.com/$REPO/releases"
TARNAME=$(basename "$TAR_URL")

mkdir -p "$DIR"
cd "$DIR"
say "Downloading $TARNAME..."
curl -fsSL "$TAR_URL" -o "$TARNAME"

# 3. Verify checksum
if [ -n "$SUM_URL" ]; then
  EXPECTED=$(curl -fsSL "$SUM_URL" | grep "$TARNAME" | awk '{print $1}')
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$TARNAME" | awk '{print $1}')
  else
    ACTUAL=$(shasum -a 256 "$TARNAME" | awk '{print $1}')
  fi
  if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then die 'Checksum mismatch - aborting.'; fi
  say 'Checksum verified.'
fi

# 4. Extract
say 'Extracting...'
tar -xzf "$TARNAME"
NODEDIR=$(find . -maxdepth 1 -type d -name 'querais-node-*' | sort | tail -n1)
[ -n "$NODEDIR" ] || die 'Extraction failed.'
cd "$NODEDIR"

# 5. Pre-create .env so the node boots straight away (no editing, no second run), even if the
#    bundled launcher is an older version that would otherwise stop to ask.
if [ ! -f .env ]; then
  cp .env.example .env
  PW=$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 48 || true)
  [ -z "$PW" ] && PW="$(date +%s)$$"
  if grep -q '^#\{0,1\}[[:space:]]*DAEMON_KEYSTORE_PASSWORD=' .env; then
    sed 's/^#\{0,1\}[[:space:]]*DAEMON_KEYSTORE_PASSWORD=.*/DAEMON_KEYSTORE_PASSWORD='"$PW"'/' .env >.env.tmp && mv .env.tmp .env
  else
    printf 'DAEMON_KEYSTORE_PASSWORD=%s\n' "$PW" >>.env
  fi
fi

# 6. Launch (installs/starts Ollama, then runs the daemon)
say 'Starting your node...'
sh ./run-node.sh
