import type { network } from 'hardhat';
import { keccak256, toHex, parseEther, type Address } from 'viem';

/** Mirrors JobEscrow.JobStatus. */
export const JobStatus = {
  NONE: 0,
  PENDING: 1,
  ASSIGNED: 2,
  COMPLETED: 3,
  VERIFIED: 4,
  FAILED: 5,
  CANCELLED: 6,
} as const;

/** Deterministic bytes32 job id from a label. */
export function jobId(label: string): `0x${string}` {
  return keccak256(toHex(label));
}

type Connection = Awaited<ReturnType<typeof network.create>>;
export type Viem = Connection['viem'];

/**
 * Deploy the full suite to a fresh in-process network and wire roles exactly like
 * the production deploy script: gateway gets ORACLE + SLASHER (registry) and
 * ORACLE + MATCHING_ENGINE (escrow). Funds the requester and node with QAIS.
 */
export async function deploy(viem: Viem) {
  const wallets = await viem.getWalletClients();
  const [deployer, gateway, node, requester, treasury, outsider] = wallets;
  if (!deployer || !gateway || !node || !requester || !treasury || !outsider) {
    throw new Error('expected >= 6 funded accounts');
  }
  const publicClient = await viem.getPublicClient();

  const token = await viem.deployContract('QUAISToken', [deployer.account.address]);
  const registry = await viem.deployContract('NodeRegistry', [
    token.address,
    deployer.account.address,
  ]);
  const escrow = await viem.deployContract('JobEscrow', [
    token.address,
    treasury.account.address,
    deployer.account.address,
  ]);

  // Grant gateway the operational roles.
  const REG_ORACLE = await registry.read.ORACLE_ROLE();
  const REG_SLASHER = await registry.read.SLASHER_ROLE();
  const ESC_ORACLE = await escrow.read.ORACLE_ROLE();
  const ESC_MATCHING = await escrow.read.MATCHING_ENGINE_ROLE();
  await registry.write.grantRole([REG_ORACLE, gateway.account.address]);
  await registry.write.grantRole([REG_SLASHER, gateway.account.address]);
  await escrow.write.grantRole([ESC_ORACLE, gateway.account.address]);
  await escrow.write.grantRole([ESC_MATCHING, gateway.account.address]);

  // Fund the requester (to pay for jobs) and node (to stake).
  await token.write.transfer([requester.account.address, parseEther('1000')]);
  await token.write.transfer([node.account.address, parseEther('5000')]);

  return {
    wallets,
    deployer,
    gateway,
    node,
    requester,
    treasury,
    outsider,
    publicClient,
    token,
    registry,
    escrow,
    roles: { REG_ORACLE, REG_SLASHER, ESC_ORACLE, ESC_MATCHING },
  };
}

/** Re-bind a deployed contract to a specific signer (to test role-gated calls). */
export async function as<N extends 'QUAISToken' | 'NodeRegistry' | 'JobEscrow'>(
  viem: Viem,
  name: N,
  address: Address,
  wallet: Awaited<ReturnType<Viem['getWalletClients']>>[number],
) {
  return viem.getContractAt(name, address, { client: { wallet } });
}

/** Standard job parameters used across escrow tests (nice round QAIS numbers). */
export const JOB = {
  maxPricePerToken: parseEther('0.001'),
  maxTokens: 1000n,
  locked: parseEther('1'), // maxPricePerToken * maxTokens
  agreedPricePerToken: parseEther('0.0008'),
  actualTokens: 500n,
  actualPayment: parseEther('0.4'), // actualTokens * agreedPricePerToken
  fee: parseEther('0.02'), // 5% of actualPayment
  providerPay: parseEther('0.38'), // 95% of actualPayment
  refund: parseEther('0.6'), // locked - actualPayment
} as const;
