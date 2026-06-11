/** One-time admin/pauser key split (docs/RUNBOOK_KEYS.md §7): move DEFAULT_ADMIN_ROLE
 * and PAUSER_ROLE from the hot gateway/deployer key to a cold admin EOA, in three
 * receipt-checked, idempotent phases with verification between them:
 *
 *   tsx scripts/split-admin.ts status --network <localhost|arbitrumSepolia>
 *   tsx scripts/split-admin.ts grant  --network ...   # hot key grants ADMIN+PAUSER to cold
 *   tsx scripts/split-admin.ts revoke --network ...   # cold key revokes both from hot
 *
 * Keys from env / repo-root .env: DEPLOYER_PRIVATE_KEY (hot), ADMIN_PRIVATE_KEY (cold).
 * Grant-before-revoke: `revoke` refuses to run unless the cold EOA already holds both
 * roles on every contract. Like pause.ts, this is tsx+viem with no Hardhat runtime.
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

const ACCESS_ABI = parseAbi([
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function PAUSER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account)',
  'function revokeRole(bytes32 role, address account)',
]);

const CONTRACTS = [
  { alias: 'registry', key: 'nodeRegistry' },
  { alias: 'escrow', key: 'jobEscrow' },
  { alias: 'credit', key: 'creditAccount' },
  { alias: 'dispute', key: 'disputeResolution' },
  { alias: 'treasury', key: 'protocolTreasury' },
  { alias: 'rewards', key: 'stakingRewards' },
] as const;

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

const [action] = process.argv.slice(2);
const netIdx = process.argv.indexOf('--network');
const network = netIdx === -1 ? '' : (process.argv[netIdx + 1] ?? '');
if (
  (action !== 'status' && action !== 'grant' && action !== 'revoke') ||
  (network !== 'localhost' && network !== 'arbitrumSepolia')
) {
  console.error(
    'Usage: tsx scripts/split-admin.ts <status|grant|revoke> --network <localhost|arbitrumSepolia>',
  );
  process.exit(2);
}

const deploymentPath = join(here, '..', 'deployments', `addresses.${network}.json`);
const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
  chainId: number;
  rpcUrl?: string;
  contracts: Record<string, Address>;
};
const env = { ...parseEnvFile(join(root, '.env')), ...process.env } as Record<string, string>;
const chain: Chain = network === 'arbitrumSepolia' ? arbitrumSepolia : hardhat;
const rpcUrl =
  network === 'arbitrumSepolia'
    ? env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc'
    : deployment.rpcUrl || 'http://127.0.0.1:8545';
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== deployment.chainId) {
  console.error(`RPC chainId ${chainId} != deployment chainId ${deployment.chainId} — aborting.`);
  process.exit(1);
}

const hotPk = env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const coldPk = env.ADMIN_PRIVATE_KEY as Hex | undefined;
if (!hotPk || !coldPk) {
  console.error('DEPLOYER_PRIVATE_KEY (hot) and ADMIN_PRIVATE_KEY (cold) are both required.');
  process.exit(1);
}
const hot = privateKeyToAccount(hotPk);
const cold = privateKeyToAccount(coldPk);
console.log(`hot  (gateway/deployer): ${hot.address}`);
console.log(`cold (admin/pauser):     ${cold.address}\n`);

const targets = CONTRACTS.flatMap((c) => {
  const address = deployment.contracts[c.key];
  if (!address) {
    // Pre-5B/6A manifests lack the newer contracts — note and continue.
    console.log(`${c.alias.padEnd(8)} (not in this deployment manifest — skipped)`);
    return [];
  }
  return [{ ...c, address }];
});

async function roles(address: Address): Promise<{ ADMIN: Hex; PAUSER: Hex }> {
  const [ADMIN, PAUSER] = await Promise.all([
    publicClient.readContract({ address, abi: ACCESS_ABI, functionName: 'DEFAULT_ADMIN_ROLE' }),
    publicClient.readContract({ address, abi: ACCESS_ABI, functionName: 'PAUSER_ROLE' }),
  ]);
  return { ADMIN, PAUSER };
}

function has(address: Address, role: Hex, account: Address): Promise<boolean> {
  return publicClient.readContract({
    address,
    abi: ACCESS_ABI,
    functionName: 'hasRole',
    args: [role, account],
  });
}

async function printStatus(): Promise<void> {
  for (const t of targets) {
    const r = await roles(t.address);
    const [hotAdmin, hotPauser, coldAdmin, coldPauser] = await Promise.all([
      has(t.address, r.ADMIN, hot.address),
      has(t.address, r.PAUSER, hot.address),
      has(t.address, r.ADMIN, cold.address),
      has(t.address, r.PAUSER, cold.address),
    ]);
    console.log(
      `${t.alias.padEnd(8)} hot: admin=${hotAdmin} pauser=${hotPauser}   cold: admin=${coldAdmin} pauser=${coldPauser}`,
    );
  }
}

/** grantRole/revokeRole with idempotence + receipt + post-state checks. Throws on failure. */
async function setRole(
  signerPk: Hex,
  contract: Address,
  alias: string,
  fn: 'grantRole' | 'revokeRole',
  role: Hex,
  roleName: string,
  account: Address,
): Promise<void> {
  const want = fn === 'grantRole';
  if ((await has(contract, role, account)) === want) {
    console.log(`${alias.padEnd(8)} ${roleName} already ${want ? 'granted' : 'revoked'} — skipped`);
    return;
  }
  const wallet = createWalletClient({
    account: privateKeyToAccount(signerPk),
    chain,
    transport: http(rpcUrl),
  });
  const hash = await wallet.writeContract({
    address: contract,
    abi: ACCESS_ABI,
    functionName: fn,
    args: [role, account],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // viem does NOT throw on a mined-but-reverted tx — check receipt.status.
  if (receipt.status !== 'success')
    throw new Error(`${alias} ${fn}(${roleName}) reverted: ${hash}`);
  if ((await has(contract, role, account)) !== want) {
    throw new Error(`${alias} ${fn}(${roleName}) post-state mismatch: ${hash}`);
  }
  console.log(`${alias.padEnd(8)} ${fn}(${roleName}, ${account}) tx=${hash}`);
}

if (action === 'status') {
  await printStatus();
} else if (action === 'grant') {
  // Phase 1 (hot signs): grant ADMIN + PAUSER to the cold EOA on every contract.
  for (const t of targets) {
    const r = await roles(t.address);
    await setRole(hotPk, t.address, t.alias, 'grantRole', r.ADMIN, 'ADMIN', cold.address);
    await setRole(hotPk, t.address, t.alias, 'grantRole', r.PAUSER, 'PAUSER', cold.address);
  }
  console.log('\nGrant phase complete. Verify with `status`, then run `revoke`.');
  await printStatus();
} else {
  // Phase 2 (cold signs): refuse unless cold holds both roles EVERYWHERE (never
  // leave a role unheld), then revoke PAUSER first and ADMIN last (admin gates revokes).
  for (const t of targets) {
    const r = await roles(t.address);
    const [coldAdmin, coldPauser] = await Promise.all([
      has(t.address, r.ADMIN, cold.address),
      has(t.address, r.PAUSER, cold.address),
    ]);
    if (!coldAdmin || !coldPauser) {
      console.error(`${t.alias}: cold EOA does not hold ADMIN+PAUSER yet — run 'grant' first.`);
      process.exit(1);
    }
  }
  for (const t of targets) {
    const r = await roles(t.address);
    await setRole(coldPk, t.address, t.alias, 'revokeRole', r.PAUSER, 'PAUSER', hot.address);
    await setRole(coldPk, t.address, t.alias, 'revokeRole', r.ADMIN, 'ADMIN', hot.address);
  }
  console.log('\nRevoke phase complete — final state:');
  await printStatus();
}
