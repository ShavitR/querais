# QueraIS node launcher (Windows). Zero-touch: the first run auto-creates your config and boots
# straight into serving — no file editing, no second run. Requires Node >= 22.13; installs and
# starts Ollama if missing. Re-run any time to restart; your wallet + stake persist.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Stop-WithMessage($msg) { Write-Host "x $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'QueraIS needs Node.js >= 22.13 - install it from https://nodejs.org and re-run.'
}
$nodeVer = (& node -v).TrimStart('v')
$p = $nodeVer.Split('.')
if ([int]$p[0] -lt 22 -or ([int]$p[0] -eq 22 -and [int]$p[1] -lt 13)) {
    Stop-WithMessage "QueraIS needs Node >= 22.13 (found $nodeVer) - update from https://nodejs.org"
}

# First run: create .env from the template with working testnet defaults and a freshly generated
# wallet password, then boot immediately. Nothing to edit; nothing to run twice. (Want to
# customize models/stake later? Edit .env and re-run.)
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    $pw = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    $lines = Get-Content .env
    if ($lines -match '^#?\s*DAEMON_KEYSTORE_PASSWORD=') {
        $lines = $lines -replace '^#?\s*DAEMON_KEYSTORE_PASSWORD=.*', "DAEMON_KEYSTORE_PASSWORD=$pw"
    }
    else {
        $lines += "DAEMON_KEYSTORE_PASSWORD=$pw"
    }
    $lines | Set-Content .env -Encoding ascii
    Write-Host ''
    Write-Host 'First run - created .env with defaults: testnet gateway, models llama3.2 + gemma3:4b, stake 2500 QAIS.' -ForegroundColor Cyan
    Write-Host 'Your node wallet is encrypted with a password generated into .env (keep that file private). Starting up...' -ForegroundColor Cyan
    Write-Host ''
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
    if (-not (Test-Ollama)) { Stop-WithMessage 'Ollama did not start - install/launch it from https://ollama.com, then re-run.' }
}

node bundle\daemon.mjs
exit $LASTEXITCODE
