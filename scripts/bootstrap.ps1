# QueraIS node — ultra one-liner (Windows): clone + setup + start.
# Requires the repo to be public (or git auth configured).
#   $env:QUERAIS_GATEWAY='ws://HOST_IP:8787/node'; irm <raw-url>/scripts/bootstrap.ps1 | iex
param(
  [string]$Gateway = $env:QUERAIS_GATEWAY,
  [string]$Dir = "$HOME\querais",
  [string]$Repo = 'https://github.com/ShavitR/querais'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  Write-Host 'Git installed. Open a NEW PowerShell and re-run.' -ForegroundColor Yellow
  exit 0
}
if (-not (Test-Path $Dir)) { git clone $Repo $Dir }
Set-Location $Dir
& ./scripts/setup-node.ps1 -Gateway $Gateway
& ./scripts/start-node.ps1
