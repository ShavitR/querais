# QueraIS node launcher (Windows). Requires Node >= 22.13 and Ollama.
# First run: copies .env.example -> .env and stops so you can edit it.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'QueraIS needs Node.js >= 22.13 - install it from https://nodejs.org'
}
node -e 'const [maj, min] = process.versions.node.split(".").map(Number); if (maj < 22 || (maj === 22 && min < 13)) { console.error(`QueraIS needs Node >= 22.13 (found ${process.versions.node})`); process.exit(1); }'
if ($LASTEXITCODE -ne 0) { exit 1 }

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host 'Created .env from .env.example - edit it (models, stake), then run me again.' -ForegroundColor Yellow
    exit 1
}

node bundle\daemon.mjs
exit $LASTEXITCODE
