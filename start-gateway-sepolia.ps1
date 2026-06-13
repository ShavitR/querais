# QueraIS gateway launcher — hosted on Arbitrum Sepolia.
#
# The repo .env is set to NETWORK=localhost for local dev, so this overrides NETWORK +
# RPC_URL to Sepolia at launch (dotenv inside main.js won't clobber an already-set env
# var). Everything else — keys, GATEWAY_API_KEYS, GATEWAY_ADMIN_TOKEN, GATEWAY_DB_PATH,
# faucet — comes from .env.
#
# Run it:               powershell -ExecutionPolicy Bypass -File .\start-gateway-sepolia.ps1
# Keep it alive 24/7:   register THIS script as a service with NSSM, or `pm2 start` it.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$env:NETWORK = 'arbitrumSepolia'
$env:RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc'
node packages/gateway/dist/main.js *>> "$PSScriptRoot\gateway-data\gateway.service.log"
