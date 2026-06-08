/**
 * Deploys the QueraIS contract suite to the selected Hardhat network and wires roles.
 *
 *   pnpm chain          # terminal 1 (local only): starts the node
 *   pnpm deploy:local   # -> --network localhost
 *   pnpm deploy:sepolia # -> --network arbitrumSepolia (needs env, see .env.example)
 *
 * Deploy order: QUAISToken -> NodeRegistry -> JobEscrow, then grant the gateway the
 * ORACLE + MATCHING_ENGINE + SLASHER roles. On `localhost` the role/treasury/test
 * addresses come from the node's funded dev accounts and the node/requester are funded
 * with QAIS; on a real network they come from env (GATEWAY_ADDRESS, TREASURY_ADDRESS,
 * NODE_ADDRESS, REQUESTER_ADDRESS) and only set test accounts are funded.
 *
 * Writes deployments/addresses.<network>.json — consumed at runtime via loadAddresses().
 */
import { network } from 'hardhat';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEther, type Address } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const deploymentsDir = join(here, '..', 'deployments');

const RPC_BY_NETWORK: Record<string, string | undefined> = {
  localhost: 'http://127.0.0.1:8545',
  arbitrumSepolia: process.env.ARBITRUM_SEPOLIA_RPC_URL,
};

function envAddress(key: string): Address | undefined {
  const v = process.env[key];
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;
}

async function main(): Promise<void> {
  const connection = await network.connect();
  const { viem, networkName } = connection;
  const isLocal = networkName === 'localhost' || networkName === 'hardhat';

  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const deployer = wallets[0];
  if (!deployer) throw new Error('No deployer account configured for this network');
  const admin = deployer.account.address;

  // Resolve role/treasury/test addresses: env first, then local dev accounts, then admin.
  const gatewayAddr = envAddress('GATEWAY_ADDRESS') ?? wallets[1]?.account.address ?? admin;
  const treasury = envAddress('TREASURY_ADDRESS') ?? wallets[4]?.account.address ?? admin;
  const nodeAddr = envAddress('NODE_ADDRESS') ?? wallets[2]?.account.address;
  const requesterAddr = envAddress('REQUESTER_ADDRESS') ?? wallets[3]?.account.address;

  console.log(`Deploying QueraIS contracts to ${networkName}…`);
  console.log('  deployer/admin:', admin);
  console.log('  gateway:       ', gatewayAddr);
  console.log('  treasury:      ', treasury);

  const token = await viem.deployContract('QUAISToken', [admin]);
  console.log('QUAISToken      ->', token.address);
  const registry = await viem.deployContract('NodeRegistry', [token.address, admin]);
  console.log('NodeRegistry    ->', registry.address);
  const escrow = await viem.deployContract('JobEscrow', [token.address, treasury, admin]);
  console.log('JobEscrow       ->', escrow.address);

  // Grant the gateway its operational roles.
  const ORACLE_ROLE = await registry.read.ORACLE_ROLE();
  const SLASHER_ROLE = await registry.read.SLASHER_ROLE();
  const MATCHING_ENGINE_ROLE = await escrow.read.MATCHING_ENGINE_ROLE();
  const ESCROW_ORACLE_ROLE = await escrow.read.ORACLE_ROLE();
  await registry.write.grantRole([ORACLE_ROLE, gatewayAddr]);
  await registry.write.grantRole([SLASHER_ROLE, gatewayAddr]);
  await escrow.write.grantRole([ESCROW_ORACLE_ROLE, gatewayAddr]);
  await escrow.write.grantRole([MATCHING_ENGINE_ROLE, gatewayAddr]);
  console.log(
    'Granted ORACLE + SLASHER (registry) and ORACLE + MATCHING_ENGINE (escrow) to gateway',
  );

  // Fund test node/requester with QAIS where we know their addresses.
  if (nodeAddr && nodeAddr !== admin) {
    await token.write.transfer([nodeAddr, parseEther('5000')]);
    console.log(`Funded node ${nodeAddr} with 5000 QAIS`);
  }
  if (requesterAddr && requesterAddr !== admin) {
    await token.write.transfer([requesterAddr, parseEther('10000')]);
    console.log(`Funded requester ${requesterAddr} with 10000 QAIS`);
  }

  const chainId = await publicClient.getChainId();
  const rpcUrl = RPC_BY_NETWORK[networkName] ?? process.env.DEPLOY_RPC_URL ?? '';

  const out = {
    chainId,
    rpcUrl,
    contracts: {
      token: token.address,
      nodeRegistry: registry.address,
      jobEscrow: escrow.address,
    },
    treasury,
    accounts: {
      deployer: admin,
      gateway: gatewayAddr,
      node: nodeAddr ?? admin,
      requester: requesterAddr ?? admin,
    },
  };

  mkdirSync(deploymentsDir, { recursive: true });
  const file = join(deploymentsDir, `addresses.${networkName}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote', file);

  if (!isLocal) {
    console.log('\nVerify on the block explorer (Etherscan v2 / Arbiscan):');
    console.log(`  hardhat verify --network ${networkName} ${token.address} ${admin}`);
    console.log(
      `  hardhat verify --network ${networkName} ${registry.address} ${token.address} ${admin}`,
    );
    console.log(
      `  hardhat verify --network ${networkName} ${escrow.address} ${token.address} ${treasury} ${admin}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
