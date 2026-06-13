import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  type Chain,
  type Hex,
} from 'viem';
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
    // Attach viem's shared nonceManager so nonces are allocated and serialized
    // *locally* instead of re-reading the RPC's `pending` count on every send.
    // The gateway issues several sequential writes per job from one wallet
    // (createJob → assignJob → completeJob → verifyAndRelease), and the public
    // Arbitrum Sepolia RPC's `pending` nonce lags under that burst — causing the
    // second/third back-to-back job to reuse a nonce ("nonce too low"). The
    // manager keeps a per-(address, chainId) high-water mark and returns
    // previousNonce+1 when the RPC lags, defeating the race. Using the shared
    // singleton (not a fresh one per client) means two clients built from the
    // same key — e.g. the gateway's settlement and faucet wallets — share one
    // counter, so their sends stay serialized too.
    account: privateKeyToAccount(privateKey, { nonceManager }),
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
  stakingRewardsAbi,
  loadAddresses,
} from '@querais/contracts';
export type { Deployment } from '@querais/contracts';
