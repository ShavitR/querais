# QueraIS node — start it (Windows). Reads .env created by setup-node.ps1.
# First run generates an encrypted wallet and auto-funds it via the gateway faucet,
# then registers and starts serving jobs.
$ErrorActionPreference = 'Stop'
Write-Host 'Starting QueraIS node...' -ForegroundColor Cyan
pnpm --filter @querais/node-daemon start
