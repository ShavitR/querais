/**
 * Deploys the QueraIS contract suite to the `localhost` Hardhat node and wires roles.
 *
 *   pnpm chain          # terminal 1: starts the node
 *   pnpm deploy:local   # terminal 2: runs this script
 *
 * Deploy order (matches the design doc): QUAISToken -> NodeRegistry -> JobEscrow,
 * then grant the gateway the ORACLE + MATCHING_ENGINE + SLASHER roles, then fund the
 * local node/requester dev accounts so the e2e slice can run immediately.
 *
 * Writes deployments/addresses.localhost.json — consumed at runtime by the gateway,
 * node-daemon, and e2e harness via `@querais/contracts` loadAddresses().
 */
import { network } from 'hardhat';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEther, formatEther } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const deploymentsDir = join(here, '..', 'deployments');

async function main(): Promise<void> {
  const { viem } = await network.connect({ network: 'localhost', chainType: 'l1' });
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const [deployer, gateway, node, requester, treasuryWallet] = wallets;
  if (!deployer || !gateway || !node || !requester || !treasuryWallet) {
    throw new Error('Expected at least 5 funded accounts on the localhost node');
  }

  const admin = deployer.account.address;
  const treasury = treasuryWallet.account.address;

  console.log('Deploying QueraIS contracts to localhost…');
  console.log('  deployer/admin:', admin);
  console.log('  gateway:       ', gateway.account.address);
  console.log('  node:          ', node.account.address);
  console.log('  requester:     ', requester.account.address);
  console.log('  treasury:      ', treasury);

  // 1. Token — entire supply minted to the deployer.
  const token = await viem.deployContract('QUAISToken', [admin]);
  console.log('QUAISToken      ->', token.address);

  // 2. NodeRegistry.
  const registry = await viem.deployContract('NodeRegistry', [token.address, admin]);
  console.log('NodeRegistry    ->', registry.address);

  // 3. JobEscrow.
  const escrow = await viem.deployContract('JobEscrow', [token.address, treasury, admin]);
  console.log('JobEscrow       ->', escrow.address);

  // 4. Grant roles to the gateway (oracle + matching engine + slasher in the MVP).
  const ORACLE_ROLE = await registry.read.ORACLE_ROLE();
  const SLASHER_ROLE = await registry.read.SLASHER_ROLE();
  const MATCHING_ENGINE_ROLE = await escrow.read.MATCHING_ENGINE_ROLE();
  const ESCROW_ORACLE_ROLE = await escrow.read.ORACLE_ROLE();

  const gw = gateway.account.address;
  await registry.write.grantRole([ORACLE_ROLE, gw]);
  await registry.write.grantRole([SLASHER_ROLE, gw]);
  await escrow.write.grantRole([ESCROW_ORACLE_ROLE, gw]);
  await escrow.write.grantRole([MATCHING_ENGINE_ROLE, gw]);
  console.log(
    'Granted ORACLE + SLASHER (registry) and ORACLE + MATCHING_ENGINE (escrow) to gateway',
  );

  // 5. Fund local dev accounts so the slice runs out of the box.
  const nodeFunding = parseEther('5000'); // enough for a Gold-tier stake
  const requesterFunding = parseEther('10000'); // spending money for jobs
  await token.write.transfer([node.account.address, nodeFunding]);
  await token.write.transfer([requester.account.address, requesterFunding]);
  console.log(
    `Funded node with ${formatEther(nodeFunding)} QAIS, requester with ${formatEther(requesterFunding)} QAIS`,
  );

  const chainId = await publicClient.getChainId();

  const out = {
    chainId,
    rpcUrl: 'http://127.0.0.1:8545',
    contracts: {
      token: token.address,
      nodeRegistry: registry.address,
      jobEscrow: escrow.address,
    },
    treasury,
    accounts: {
      deployer: admin,
      gateway: gw,
      node: node.account.address,
      requester: requester.account.address,
    },
  };

  mkdirSync(deploymentsDir, { recursive: true });
  const file = join(deploymentsDir, 'addresses.localhost.json');
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote', file);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
