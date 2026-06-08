/**
 * Prepare a node for the VM: generate a fresh wallet, auto-fund it from the deployer
 * (Sepolia ETH for gas + QAIS for stake), and print a ready-to-paste `node.env`.
 *
 *   pnpm prepare:vm-node
 *
 * Copy the printed node.env to the VM (edit HOST_IP), then `docker compose --env-file
 * node.env up -d --build`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEther, formatEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadAddresses, makePublicClient, makeWalletClient, quaisTokenAbi } from '@querais/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODEL = process.env.DEMO_MODEL ?? 'gemma3:4b';

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
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

  const nodeKey = generatePrivateKey();
  const nodeAddr = privateKeyToAccount(nodeKey).address;

  console.log(`Funding new VM node ${nodeAddr} from the deployer…`);
  const ethHash = await deployer.sendTransaction({ to: nodeAddr, value: parseEther('0.01') });
  await pub.waitForTransactionReceipt({ hash: ethHash });
  const qaisHash = await deployer.writeContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'transfer',
    args: [nodeAddr, parseEther('5000')],
  });
  await pub.waitForTransactionReceipt({ hash: qaisHash });
  console.log('Funded: 0.01 ETH (gas) + 5000 QAIS (stake).');

  const balance = await pub.getBalance({ address: nodeAddr });
  console.log(`Node ETH balance: ${formatEther(balance)}\n`);

  console.log('───────────────────────────────────────────────────────────────');
  console.log('Copy the block below to a file named  node.env  on the VM');
  console.log('and replace HOST_IP with your host’s Hyper-V address:');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`NETWORK=arbitrumSepolia`);
  console.log(`RPC_URL=https://sepolia-rollup.arbitrum.io/rpc`);
  console.log(`GATEWAY_WS_URL=ws://HOST_IP:8787/node`);
  console.log(`DAEMON_MODELS=${MODEL}`);
  console.log(`NODE_PRIVATE_KEY=${nodeKey}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Then on the VM:  docker compose --env-file node.env up -d --build');
  console.log(`Watch it on Arbiscan: https://sepolia.arbiscan.io/address/${nodeAddr}`);
}

void main();
