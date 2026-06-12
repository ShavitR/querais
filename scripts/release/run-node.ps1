# QueraIS node launcher (Windows). Requires Node >= 22.13 and Ollama.
# First run: copies .env.example -> .env and stops so you can edit it.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'QueraIS needs Node.js >= 22.13 - install it from https://nodejs.org'
}
# Parse the version in PowerShell — do NOT shell out to `node -e "..."`: PowerShell strips the
# embedded double quotes when passing the script to node, which corrupts it (split(".") -> split(.)).
$nodeVersion = (& node --version).TrimStart('v')   # e.g. "26.2.0"
$parts = $nodeVersion.Split('.')
$maj = [int]$parts[0]
$min = [int]$parts[1]
if ($maj -lt 22 -or ($maj -eq 22 -and $min -lt 13)) {
    Write-Error "QueraIS needs Node >= 22.13 (found $nodeVersion)"
}

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host 'Created .env from .env.example - edit it (models, stake), then run me again.' -ForegroundColor Yellow
    exit 1
}

node bundle\daemon.mjs
exit $LASTEXITCODE
