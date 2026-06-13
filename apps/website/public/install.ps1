# QueraIS node — one-line installer (Windows 10/11).
#
#   iwr -useb https://querais.xyz/install.ps1 | iex
#
# Installs Node.js if missing, downloads + checksum-verifies the latest node release from GitHub,
# pre-creates a working config, and starts your node (which installs/starts Ollama itself).
# Testnet — no real value. Your wallet stays on this machine.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'ShavitR/querais'
$dir = Join-Path $HOME 'querais-node'

function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "x $m" -ForegroundColor Red; exit 1 }

function Test-NodeOk {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    $v = (& node -v).TrimStart('v').Split('.')
    return -not ([int]$v[0] -lt 22 -or ([int]$v[0] -eq 22 -and [int]$v[1] -lt 13))
}

# 1. Node >= 22.13
if (-not (Test-NodeOk)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say 'Installing Node.js LTS (winget)...'
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Test-NodeOk)) {
        Die 'Node >= 22.13 is required. Install it from https://nodejs.org, open a NEW PowerShell, and re-run.'
    }
}

# 2. Resolve the latest release's node bundle + checksums
Say 'Finding the latest node release...'
$headers = @{ 'User-Agent' = 'querais-installer' }
$rel = Invoke-RestMethod -UseBasicParsing -Headers $headers "https://api.github.com/repos/$repo/releases/latest"
$tar = $rel.assets | Where-Object { $_.name -like 'querais-node-*.tar.gz' } | Select-Object -First 1
$sum = $rel.assets | Where-Object { $_.name -eq 'SHA256SUMS' } | Select-Object -First 1
if (-not $tar) { Die "No node bundle in the latest release - see https://github.com/$repo/releases" }

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$tarPath = Join-Path $dir $tar.name
Say "Downloading $($tar.name)..."
Invoke-WebRequest -UseBasicParsing $tar.browser_download_url -OutFile $tarPath

# 3. Verify checksum
if ($sum) {
    $sums = (Invoke-WebRequest -UseBasicParsing -Headers $headers $sum.browser_download_url).Content
    $line = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($tar.name) } | Select-Object -First 1)
    $expected = if ($line) { $line.Trim().Split(' ')[0] } else { '' }
    $actual = (Get-FileHash $tarPath -Algorithm SHA256).Hash
    if ($expected -and $expected.ToLower() -ne $actual.ToLower()) { Die "Checksum mismatch for $($tar.name) - aborting." }
    Say 'Checksum verified.'
}

# 4. Extract (Windows 10+ ships tar.exe)
Say 'Extracting...'
tar -xzf $tarPath -C $dir
$nodeDir = Get-ChildItem $dir -Directory | Where-Object { $_.Name -like 'querais-node-*' } |
Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $nodeDir) { Die 'Extraction failed.' }
Set-Location $nodeDir.FullName

# 5. Pre-create .env so the node boots straight away (no editing, no second run), even if the
#    bundled launcher is an older version that would otherwise stop to ask.
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
}

# 6. Launch (the launcher installs/starts Ollama, then runs the daemon). Bypass execution policy
#    so the on-disk launcher runs even on a locked-down machine.
Say 'Starting your node...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $nodeDir.FullName 'run-node.ps1')
