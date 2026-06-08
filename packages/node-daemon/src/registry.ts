import {
  nodeRegistryAbi,
  quaisTokenAbi,
  type Deployment,
  type QueraisPublicClient,
  type QueraisWalletClient,
} from '@querais/shared';
import type { Hex } from 'viem';

/**
 * Ensure the node is registered + staked on-chain. Idempotent: if the wallet is
 * already a registered node, does nothing. Otherwise approves the stake and calls
 * registerNode, waiting for both receipts.
 */
export async function ensureRegistered(
  publicClient: QueraisPublicClient,
  walletClient: QueraisWalletClient,
  deployment: Deployment,
  nodeId: Hex,
  stakeWei: bigint,
): Promise<{ alreadyRegistered: boolean }> {
  const wallet = walletClient.account.address;

  const node = await publicClient.readContract({
    address: deployment.contracts.nodeRegistry,
    abi: nodeRegistryAbi,
    functionName: 'getNode',
    args: [wallet],
  });
  if (node.exists) return { alreadyRegistered: true };

  const approveHash = await walletClient.writeContract({
    address: deployment.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'approve',
    args: [deployment.contracts.nodeRegistry, stakeWei],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const registerHash = await walletClient.writeContract({
    address: deployment.contracts.nodeRegistry,
    abi: nodeRegistryAbi,
    functionName: 'registerNode',
    args: [nodeId, stakeWei],
  });
  await publicClient.waitForTransactionReceipt({ hash: registerHash });

  return { alreadyRegistered: false };
}
