# QueraIS node installer (Windows). Requires Docker Desktop. Prompts for the public
# gateway, writes node.env, and starts Ollama + the node daemon via docker compose.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'Docker is required: https://docs.docker.com/get-docker/'
  exit 1
}

$gateway = Read-Host 'Public gateway WS URL (e.g. wss://gateway.example/node)'
$models = Read-Host 'Models to serve [gemma3:4b]'
if ([string]::IsNullOrWhiteSpace($models)) { $models = 'gemma3:4b' }
$password = Read-Host 'Keystore password (encrypts your node wallet)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

@"
NETWORK=arbitrumSepolia
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
GATEWAY_WS_URL=$gateway
DAEMON_MODELS=$models
DAEMON_KEYSTORE_PASSWORD=$plain
"@ | Out-File -FilePath node.env -Encoding ascii

Write-Host 'Starting Ollama + node daemon...'
docker compose --env-file node.env up -d --build

Write-Host ''
Write-Host 'Node started. Next steps:'
Write-Host "  1. Find your node wallet address:  docker compose logs node | Select-String 'node ready on-chain'"
Write-Host '  2. Fund it with a little Arbitrum Sepolia ETH (gas) and QAIS (stake) - use the faucet.'
Write-Host '  3. The node auto-registers and joins the marketplace.'
