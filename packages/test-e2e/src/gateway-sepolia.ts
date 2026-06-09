/**
 * Run the QueraIS gateway on Arbitrum Sepolia, reachable on the LAN/Hyper-V network
 * (binds 0.0.0.0:8787), so a node on another machine (a VM) can join. The deployer
 * acts as gateway + requester + treasury + faucet distributor (it holds roles + QAIS).
 *
 *   pnpm gateway:sepolia
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { parseEther, type Address, type Hex } from 'viem';
import { loadAddresses, makePublicClient, makeWalletClient, quaisTokenAbi } from '@querais/shared';
import { buildGateway, type GatewayConfig } from '@querais/gateway';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = Number(process.env.GATEWAY_PORT ?? '8787');
const API_KEY = process.env.HOST_API_KEY ?? 'sk-host';
const ADMIN_TOKEN = process.env.HOST_ADMIN_TOKEN ?? 'admin-host';

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

function lanIPv4s(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address}  (${name})`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const env = parseEnv(readFileSync(join(ROOT, '.env'), 'utf8'));
  const deployerKey = env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY missing in .env');

  const dep = loadAddresses('arbitrumSepolia');
  const pub = makePublicClient(dep.rpcUrl, dep.chainId);
  const deployer = makeWalletClient(dep.rpcUrl, deployerKey, dep.chainId);
  const requester = deployer.account.address;

  // Requester (deployer) approves the escrow once so jobs can be paid.
  const approveHash = await deployer.writeContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'approve',
    args: [dep.contracts.jobEscrow, parseEther('100000')],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });

  const config: GatewayConfig = {
    port: PORT,
    network: 'arbitrumSepolia',
    rpcUrl: dep.rpcUrl,
    privateKey: deployerKey,
    apiKeys: new Map<string, Address>([[API_KEY, requester]]),
    defaultMaxTokens: 128,
    defaultMaxPricePerTokenWei: parseEther('0.001'),
    defaultMinReputation: 0,
    jobDeadlineSeconds: 300,
    rateLimitMax: 1000,
    batchFlushThreshold: Number(process.env.GATEWAY_BATCH_FLUSH_THRESHOLD ?? '10'),
    batchFlushIntervalSeconds: Number(process.env.GATEWAY_BATCH_FLUSH_INTERVAL_SECONDS ?? '60'),
    sessionDeadlineMarginSeconds: Number(
      process.env.GATEWAY_SESSION_DEADLINE_MARGIN_SECONDS ?? '600',
    ),
    adminToken: ADMIN_TOKEN,
    faucetAmountWei: parseEther('5000'),
    faucetEthWei: parseEther('0.003'), // drip gas so new nodes self-fund (zero-touch)
    faucetPrivateKey: deployerKey, // distributor for /v1/faucet
  };

  const { app } = await buildGateway({ config });
  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log('\n✅ QueraIS gateway live on Arbitrum Sepolia');
  console.log(`   Local:   http://127.0.0.1:${PORT}`);
  console.log('   Reachable on one of these host addresses (use the Hyper-V one for the VM):');
  for (const ip of lanIPv4s()) console.log(`     http://${ip.split('  ')[0]}:${PORT}    ${ip}`);
  console.log(`\n   API key (for submitting jobs):  ${API_KEY}`);
  console.log(`   Admin token (for /v1/keys):     ${ADMIN_TOKEN}`);
  console.log(`   Node WS endpoint for the VM:    ws://<HOST_IP>:${PORT}/node`);
  console.log('\n   Windows Firewall (run once, as admin):');
  console.log(
    `     New-NetFirewallRule -DisplayName "QueraIS ${PORT}" -Direction Inbound -LocalPort ${PORT} -Protocol TCP -Action Allow`,
  );
  console.log('\n   Leave this running. Ctrl+C to stop.');

  process.on('SIGINT', () => {
    void app.close().then(() => process.exit(0));
  });
}

void main();
