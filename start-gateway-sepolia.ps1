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
# On Sepolia the operator wallet is the DEPLOYER (0xc80A…) — it holds the ORACLE/MATCHING/
# SLASHER/SETTLER roles AND the QAIS supply. The repo .env's GATEWAY_PRIVATE_KEY is a localhost
# Hardhat dev key (0x7099…), so use DEPLOYER_PRIVATE_KEY as the gateway + faucet distributor key
# for the live gateway. (dotenv inside main.js won't override an already-set env var.)
$depLine = (Select-String -Path .env -Pattern '^DEPLOYER_PRIVATE_KEY=' | Select-Object -First 1).Line
if ($depLine) {
  $dep = ($depLine -replace '^DEPLOYER_PRIVATE_KEY=', '' -replace '"', '').Trim()
  $env:GATEWAY_PRIVATE_KEY = $dep
  $env:GATEWAY_FAUCET_PRIVATE_KEY = $dep
}
node packages/gateway/dist/main.js *>> "$PSScriptRoot\gateway-data\gateway.service.log"
