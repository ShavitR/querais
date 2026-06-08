#!/usr/bin/env bash
# QueraIS node — ultra one-liner (Linux/macOS): clone + setup + start.
# Requires the repo to be public (or git auth configured).
#   QUERAIS_GATEWAY=ws://HOST_IP:8787/node bash <(curl -fsSL <raw-url>/scripts/bootstrap.sh)
set -euo pipefail
GATEWAY="${1:-${QUERAIS_GATEWAY:-}}"
DIR="${QUERAIS_DIR:-$HOME/querais}"
REPO="${QUERAIS_REPO:-https://github.com/ShavitR/querais}"
command -v git >/dev/null 2>&1 || { echo "Install git first"; exit 1; }
[ -d "$DIR" ] || git clone "$REPO" "$DIR"
cd "$DIR"
./scripts/setup-node.sh "$GATEWAY"
./scripts/start-node.sh
