/**
 * Runtime loader for deployed contract addresses. Kept separate from build output so
 * the package compiles even before any deployment exists; consumers (gateway,
 * node-daemon, e2e) call loadAddresses() at runtime, after `pnpm deploy:local`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type Address = `0x${string}`;

export interface Deployment {
  chainId: number;
  rpcUrl: string;
  contracts: {
    token: Address;
    nodeRegistry: Address;
    jobEscrow: Address;
    creditAccount: Address;
    /** Absent on deployments that predate Slice 5B (disputes disabled there). */
    disputeResolution?: Address;
    /** Absent on deployments that predate Slice 6A (fees go to the treasury EOA). */
    protocolTreasury?: Address;
  };
  treasury: Address;
  accounts: {
    deployer: Address;
    gateway: Address;
    node: Address;
    requester: Address;
  };
}

/**
 * Load the deployment manifest for a network. Both `src/` (tsx) and `dist/` (built)
 * sit one level under the package root, so `../deployments` resolves from either.
 */
export function loadAddresses(networkName = 'localhost'): Deployment {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, '..', 'deployments', `addresses.${networkName}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Deployment;
  } catch {
    throw new Error(`No deployment found at ${file}. Run \`pnpm deploy:local\` first.`);
  }
}
