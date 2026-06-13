# QueraIS node launcher (Windows). Requires Node >= 22.13 and Ollama.
# First run: copies .env.example -> .env and stops so you can edit it.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'QueraIS needs Node.js >= 22.13 - install it from https://nodejs.org'
}
$nodeVer = (& node -v).TrimStart('v')
$p = $nodeVer.Split('.')
if ([int]$p[0] -lt 22 -or ([int]$p[0] -eq 22 -and [int]$p[1] -lt 13)) {
    Write-Error "QueraIS needs Node >= 22.13 (found $nodeVer) - update from https://nodejs.org"
}

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host 'Created .env from .env.example - edit it (models, stake), then run me again.' -ForegroundColor Yellow
    exit 1
}

node bundle\daemon.mjs
exit $LASTEXITCODE
