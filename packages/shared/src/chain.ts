import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

/**
 * Thin viem helpers + a single re-export point for the contract ABIs and the
 * deployed-address loader, so gateway / node-daemon / e2e import everything chain
 * related from `@querais/shared`. The local dev chain is Hardhat (chainId 31337).
 */

export function makePublicClient(rpcUrl: string) {
  return createPublicClient({ chain: hardhat, transport: http(rpcUrl) });
}

export function makeWalletClient(rpcUrl: string, privateKey: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: hardhat,
    transport: http(rpcUrl),
  });
}

export type QueraisPublicClient = ReturnType<typeof makePublicClient>;
export type QueraisWalletClient = ReturnType<typeof makeWalletClient>;

export { quaisTokenAbi, nodeRegistryAbi, jobEscrowAbi, loadAddresses } from '@querais/contracts';
export type { Deployment } from '@querais/contracts';
