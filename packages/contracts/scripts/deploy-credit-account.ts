/**
 * ADDITIVE deploy of CreditAccount.sol onto an EXISTING QueraIS deployment.
 *
 *   pnpm deploy:credit:sepolia   # -> --network arbitrumSepolia
 *
 * Unlike scripts/deploy.ts (which deploys the whole suite fresh), this script leaves the
 * already-deployed QUAISToken / NodeRegistry / JobEscrow — and any staked nodes — untouched.
 * It reuses the existing token + treasury from the committed manifest, deploys ONLY
 * CreditAccount, grants the gateway SETTLER_ROLE, and patches `contracts.creditAccount` into
 * deployments/addresses.<network>.json. Used for the Slice 2A checkpoint.
 */
import { network } from 'hardhat';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Address } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const deploymentsDir = join(here, '..', 'deployments');

interface Manifest {
  chainId: number;
  rpcUrl: string;
  contracts: { token: Address; nodeRegistry: Address; jobEscrow: Address; creditAccount?: Address };
  treasury: Address;
  accounts: { deployer: Address; gateway: Address; node: Address; requester: Address };
}

async function main(): Promise<void> {
  const connection = await network.connect();
  const { viem, networkName } = connection;
  const isLocal = networkName === 'localhost' || networkName === 'hardhat';

  const file = join(deploymentsDir, `addresses.${networkName}.json`);
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;

  const wallets = await viem.getWalletClients();
  const deployer = wallets[0];
  if (!deployer) throw new Error('No deployer account configured for this network');
  const admin = deployer.account.address;
  const { token } = manifest.contracts;
  const { treasury } = manifest;
  const gatewayAddr = manifest.accounts.gateway;

  console.log(`Additive deploy: CreditAccount onto ${networkName}…`);
  console.log('  deployer/admin:', admin);
  console.log('  reusing token: ', token);
  console.log('  treasury:      ', treasury);
  console.log('  gateway:       ', gatewayAddr);
  if (manifest.contracts.creditAccount) {
    console.log(
      '  NOTE: manifest already has creditAccount',
      manifest.contracts.creditAccount,
      '— overwriting',
    );
  }

  const credit = await viem.deployContract('CreditAccount', [token, treasury, admin]);
  console.log('CreditAccount   ->', credit.address);

  const SETTLER_ROLE = await credit.read.SETTLER_ROLE();
  await credit.write.grantRole([SETTLER_ROLE, gatewayAddr]);
  console.log('Granted SETTLER_ROLE to gateway');

  manifest.contracts.creditAccount = credit.address;
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Patched', file);

  if (!isLocal) {
    console.log('\nVerify on the block explorer (Etherscan v2 / Arbiscan):');
    console.log(
      `  hardhat verify --network ${networkName} ${credit.address} ${token} ${treasury} ${admin}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
