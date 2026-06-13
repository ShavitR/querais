# QueraIS node launcher (Windows). Requires Node >= 22.13; installs + starts Ollama if missing.
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

# Ensure Ollama (the inference backend) is installed and running. The daemon talks to it over
# HTTP (OLLAMA_URL, default http://127.0.0.1:11434) and auto-pulls the configured model.
function Test-Ollama { try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:11434/'; return $true } catch { return $false } }
if (-not (Test-Ollama)) {
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Host 'Ollama not found - installing it (winget)...' -ForegroundColor Yellow
        winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
    }
    if (-not (Test-Ollama)) {
        $ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
        if (-not $ollamaExe) { $ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
        if (Test-Path $ollamaExe) { Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden }
    }
    Write-Host 'Waiting for Ollama to start...' -ForegroundColor Yellow
    $tries = 0
    while (-not (Test-Ollama) -and $tries -lt 30) { Start-Sleep 2; $tries++ }
    if (-not (Test-Ollama)) { Write-Error 'Ollama did not start - install/launch it from https://ollama.com, then re-run.' }
}

node bundle\daemon.mjs
exit $LASTEXITCODE
