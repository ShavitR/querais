/** Emergency pause/unpause for the Pausable contracts (NodeRegistry, JobEscrow,
 * CreditAccount, DisputeResolution). Incident tooling — deliberately tsx + viem with NO
 * Hardhat runtime, so it works even when the dev toolchain doesn't. See
 * docs/RUNBOOK_KEYS.md.
 *
 *   tsx scripts/pause.ts <status|pause|unpause> --network <localhost|arbitrumSepolia>
 *                        [--contracts registry,escrow,credit,dispute]
 *
 * `status` is read-only (no key). `pause`/`unpause` sign with PAUSER_PRIVATE_KEY
 * (fallback DEPLOYER_PRIVATE_KEY) from the process env or the repo-root .env.
 * Idempotent: contracts already in the target state are skipped. Every write is
 * receipt-checked (a mined-but-reverted tx is a hard failure). Exits non-zero on
 * any failure. QUAISToken is NOT pausable — token transfers cannot be frozen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, hardhat } from 'viem/chains';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const PAUSABLE_ABI = parseAbi([
  'function pause()',
  'function unpause()',
  'function paused() view returns (bool)',
]);

const CONTRACT_KEYS = {
  registry: 'nodeRegistry',
  escrow: 'jobEscrow',
  credit: 'creditAccount',
  dispute: 'disputeResolution',
} as const;
type ContractAlias = keyof typeof CONTRACT_KEYS;

interface Deployment {
  chainId: number;
  rpcUrl?: string;
  contracts: Record<string, Address>;
}

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

function parseArgs(argv: string[]) {
  const [action] = argv;
  if (action !== 'status' && action !== 'pause' && action !== 'unpause') {
    console.error(
      'Usage: tsx scripts/pause.ts <status|pause|unpause> --network <localhost|arbitrumSepolia> [--contracts registry,escrow,credit,dispute]',
    );
    process.exit(2);
  }
  let network = '';
  let contracts: ContractAlias[] = ['registry', 'escrow', 'credit', 'dispute'];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--network') network = argv[++i] ?? '';
    else if (argv[i] === '--contracts') {
      contracts = (argv[++i] ?? '').split(',').filter(Boolean) as ContractAlias[];
      for (const c of contracts) {
        if (!(c in CONTRACT_KEYS)) {
          console.error(`Unknown contract alias '${c}' (use registry,escrow,credit,dispute)`);
          process.exit(2);
        }
      }
    }
  }
  if (network !== 'localhost' && network !== 'arbitrumSepolia') {
    console.error("Missing/invalid --network (use 'localhost' or 'arbitrumSepolia')");
    process.exit(2);
  }
  return { action, network, contracts } as const;
}

const { action, network, contracts } = parseArgs(process.argv.slice(2));

const deploymentPath = join(here, '..', 'deployments', `addresses.${network}.json`);
if (!existsSync(deploymentPath)) {
  console.error(`No deployment manifest at ${deploymentPath}`);
  process.exit(1);
}
const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as Deployment;

const env = { ...parseEnvFile(join(root, '.env')), ...process.env } as Record<string, string>;
const chain: Chain = network === 'arbitrumSepolia' ? arbitrumSepolia : hardhat;
const rpcUrl =
  network === 'arbitrumSepolia'
    ? env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'
    : deployment.rpcUrl || 'http://127.0.0.1:8545';

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const targets = contracts.flatMap((alias) => {
  const address = deployment.contracts[CONTRACT_KEYS[alias]];
  if (!address) {
    if (alias === 'dispute') {
      // Pre-5B deployments have no DisputeResolution — skip rather than fail the drill.
      console.log('dispute  (not in this deployment manifest — skipped)');
      return [];
    }
    console.error(`Deployment manifest has no address for '${CONTRACT_KEYS[alias]}'`);
    process.exit(1);
  }
  return [{ alias, address }];
});

const chainId = await publicClient.getChainId();
if (chainId !== deployment.chainId) {
  console.error(`RPC chainId ${chainId} != deployment chainId ${deployment.chainId} — aborting.`);
  process.exit(1);
}

let failed = false;

if (action === 'status') {
  for (const t of targets) {
    const paused = await publicClient.readContract({
      address: t.address,
      abi: PAUSABLE_ABI,
      functionName: 'paused',
    });
    console.log(`${t.alias.padEnd(8)} ${t.address}  paused=${paused}`);
  }
} else {
  const pk = env.PAUSER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    console.error('PAUSER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) required for pause/unpause');
    process.exit(1);
  }
  const account = privateKeyToAccount(pk as Hex);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const wantPaused = action === 'pause';
  console.log(`Signer: ${account.address}  network: ${network}  action: ${action}`);

  for (const t of targets) {
    const paused = await publicClient.readContract({
      address: t.address,
      abi: PAUSABLE_ABI,
      functionName: 'paused',
    });
    if (paused === wantPaused) {
      console.log(`${t.alias.padEnd(8)} ${t.address}  already ${action}d — skipped`);
      continue;
    }
    try {
      const hash = await walletClient.writeContract({
        address: t.address,
        abi: PAUSABLE_ABI,
        functionName: action,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // viem does NOT throw on a mined-but-reverted tx — check receipt.status.
      if (receipt.status !== 'success') throw new Error(`tx ${hash} reverted`);
      const after = await publicClient.readContract({
        address: t.address,
        abi: PAUSABLE_ABI,
        functionName: 'paused',
      });
      console.log(`${t.alias.padEnd(8)} ${t.address}  ${action} tx=${hash}  paused=${after}`);
      if (after !== wantPaused) throw new Error('post-state mismatch');
    } catch (err) {
      failed = true;
      console.error(`${t.alias.padEnd(8)} ${t.address}  ${action} FAILED: ${String(err)}`);
    }
  }
}

if (failed) {
  console.error('\n❌ One or more contracts failed — see above.');
  process.exit(1);
}
