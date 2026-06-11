import { createPublicClient, createWalletClient, http, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, arbitrumSepolia } from 'viem/chains';

/**
 * Thin viem helpers + a single re-export point for the contract ABIs and the
 * deployed-address loader, so gateway / node-daemon / e2e import everything chain
 * related from `@querais/shared`.
 *
 * The viem chain is resolved from the deployment's chainId so the same code runs
 * against the local Hardhat node (31337) and Arbitrum Sepolia (421614). Pass the
 * chainId from `loadAddresses(network).chainId`; it defaults to Hardhat for back-compat.
 */

const CHAINS: Record<number, Chain> = {
  [hardhat.id]: hardhat, // 31337
  [arbitrumSepolia.id]: arbitrumSepolia, // 421614
};

export function resolveChain(chainId?: number): Chain {
  return (chainId !== undefined && CHAINS[chainId]) || hardhat;
}

export function makePublicClient(rpcUrl: string, chainId?: number) {
  return createPublicClient({ chain: resolveChain(chainId), transport: http(rpcUrl) });
}

export function makeWalletClient(rpcUrl: string, privateKey: Hex, chainId?: number) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: resolveChain(chainId),
    transport: http(rpcUrl),
  });
}

export type QueraisPublicClient = ReturnType<typeof makePublicClient>;
export type QueraisWalletClient = ReturnType<typeof makeWalletClient>;

export {
  quaisTokenAbi,
  nodeRegistryAbi,
  jobEscrowAbi,
  creditAccountAbi,
  disputeResolutionAbi,
  protocolTreasuryAbi,
  loadAddresses,
} from '@querais/contracts';
export type { Deployment } from '@querais/contracts';
