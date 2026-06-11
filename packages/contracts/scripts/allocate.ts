/** Execute one ProtocolTreasury.allocate() payout from the COLD admin key (Slice 6C).
 * Ops tooling — deliberately tsx + viem with NO Hardhat runtime, like pause.ts.
 *
 *   tsx scripts/allocate.ts --network <localhost|arbitrumSepolia> \
 *       --recipient 0x... --amount <QAIS> --purpose "incentive:first-model:llama3"
 *
 * Signs with ADMIN_PRIVATE_KEY (fallback DEPLOYER_PRIVATE_KEY) from the process env or
 * the repo-root .env. Receipt-checked; exits non-zero on failure. The purpose string is
 * the on-chain dedup key for one-time bonuses — copy it EXACTLY from
 * GET /v1/admin/incentives (see docs/INCENTIVES.md for the operator flow).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, hardhat } from 'viem/chains';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const TREASURY_ABI = parseAbi([
  'function allocate(address recipient, uint256 amount, string purpose)',
  'function opsRetainedWei() view returns (uint256)',
]);

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const network = arg('--network');
const recipient = arg('--recipient');
const amountQais = arg('--amount');
const purpose = arg('--purpose');
if (
  (network !== 'localhost' && network !== 'arbitrumSepolia') ||
  !recipient ||
  !/^0x[0-9a-fA-F]{40}$/.test(recipient) ||
  !amountQais ||
  !purpose
) {
  console.error(
    'Usage: tsx scripts/allocate.ts --network <localhost|arbitrumSepolia> --recipient 0x… --amount <QAIS> --purpose "incentive:…"',
  );
  process.exit(2);
}

const deploymentPath = join(here, '..', 'deployments', `addresses.${network}.json`);
if (!existsSync(deploymentPath)) {
  console.error(`No deployment manifest at ${deploymentPath}`);
  process.exit(1);
}
const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
  chainId: number;
  rpcUrl?: string;
  contracts: Record<string, Address>;
};
const treasury = deployment.contracts.protocolTreasury;
if (!treasury) {
  console.error('This deployment has no ProtocolTreasury (pre-6A manifest).');
  process.exit(1);
}

const env = { ...parseEnvFile(join(root, '.env')), ...process.env } as Record<string, string>;
const chain: Chain = network === 'arbitrumSepolia' ? arbitrumSepolia : hardhat;
const rpcUrl =
  network === 'arbitrumSepolia'
    ? env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'
    : deployment.rpcUrl || 'http://127.0.0.1:8545';

const pk = env.ADMIN_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error('ADMIN_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) required — allocate() is admin-gated');
  process.exit(1);
}
const account = privateKeyToAccount(pk as Hex);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const amountWei = parseEther(amountQais);
const spendable = await publicClient.readContract({
  address: treasury,
  abi: TREASURY_ABI,
  functionName: 'opsRetainedWei',
});
console.log(`Signer: ${account.address}  network: ${network}`);
console.log(`Treasury ${treasury}  ops spendable: ${spendable} wei`);
console.log(`Allocating ${amountQais} QAIS -> ${recipient}`);
console.log(`Purpose: ${purpose}`);
if (amountWei > spendable) {
  console.error('❌ amount exceeds the spendable ops share — run distribute() first.');
  process.exit(1);
}

const hash = await walletClient.writeContract({
  address: treasury,
  abi: TREASURY_ABI,
  functionName: 'allocate',
  args: [recipient as Address, amountWei, purpose],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
// viem does NOT throw on a mined-but-reverted tx — check receipt.status.
if (receipt.status !== 'success') {
  console.error(`❌ allocate reverted (tx ${hash})`);
  process.exit(1);
}
console.log(`✅ allocated  tx=${hash}`);
