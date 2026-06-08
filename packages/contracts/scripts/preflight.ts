/** Preflight for a testnet deploy: derive the deployer address from .env, show its
 * Arbitrum Sepolia balance, and confirm the Etherscan key is present. Run via
 * `pnpm preflight:sepolia`. Reads the repo-root .env directly (no hardhat needed). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, formatEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

const env = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
const pk = env.DEPLOYER_PRIVATE_KEY;
if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY missing in .env');

const account = privateKeyToAccount(pk as Hex);
const rpcUrl = env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

const [balance, chainId] = await Promise.all([
  client.getBalance({ address: account.address }),
  client.getChainId(),
]);

console.log('Deployer address :', account.address);
console.log(
  'RPC chainId      :',
  chainId,
  chainId === 421614 ? '(Arbitrum Sepolia ✓)' : '(unexpected!)',
);
console.log('Balance          :', formatEther(balance), 'ETH');
console.log(
  'Etherscan key    :',
  env.ETHERSCAN_API_KEY ? 'set ✓' : 'MISSING (verification will be skipped)',
);

if (balance === 0n) {
  console.error('\n❌ Deployer has 0 ETH on Arbitrum Sepolia — fund it before deploying.');
  process.exit(1);
}
console.log('\n✅ Funded and ready to deploy.');
