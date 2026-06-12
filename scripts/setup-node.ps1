# QueraIS node — one-command setup (Windows, no Docker).
# Installs Node + Ollama (via winget if missing), builds, pulls the model, writes .env.
# Usage:  ./scripts/setup-node.ps1 -Gateway ws://HOST_IP:8787/node [-Model gemma3:4b]
param(
  [string]$Gateway = $env:QUERAIS_GATEWAY,
  [string]$Model = 'gemma3:4b'
)
$ErrorActionPreference = 'Stop'
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

Write-Host '=== QueraIS node setup ===' -ForegroundColor Cyan

if (-not (Have node)) {
  Write-Host 'Installing Node.js (winget)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Write-Host 'Node installed. Close this window, open a NEW PowerShell, and re-run this script.' -ForegroundColor Yellow
  exit 0
}
$nodeOk = & node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.stdout.write(a>22||(a===22&&b>=13)?"ok":"old")'
if ($nodeOk -ne 'ok') {
  Write-Error "QueraIS needs Node >= 22.13 (found $(node -v)). Update from https://nodejs.org, then re-run."
}
if (-not (Have pnpm)) {
  corepack enable 2>$null
  if (-not (Have pnpm)) { npm install -g pnpm }
}
if (-not (Have ollama)) {
  Write-Host 'Installing Ollama (winget)...'
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
}

if (-not $Gateway) { $Gateway = Read-Host 'Gateway WS URL (e.g. ws://172.27.160.1:8787/node)' }

Write-Host 'Installing dependencies...'
pnpm install
Write-Host 'Building...'
pnpm build
Write-Host "Pulling model $Model (first time can take a few minutes)..."
ollama pull $Model

@"
NETWORK=arbitrumSepolia
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
GATEWAY_WS_URL=$Gateway
OLLAMA_URL=http://127.0.0.1:11434
DAEMON_MODELS=$Model
"@ | Out-File -FilePath .env -Encoding ascii

Write-Host ''
Write-Host 'Setup complete. Start your node with:' -ForegroundColor Green
Write-Host '  ./scripts/start-node.ps1'
Write-Host 'First run generates a wallet and prints its address. If the gateway has a faucet'
Write-Host 'enabled it auto-funds gas + stake; otherwise fund that address before it can register.'
