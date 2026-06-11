import type { network } from 'hardhat';
import {
  hashTypedData,
  keccak256,
  toHex,
  parseEther,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Well-known Hardhat dev private keys (the standard "test … junk" mnemonic), index-aligned
 * with `viem.getWalletClients()`. Test-only — used to produce EIP-712 signatures off-chain
 * for the same accounts that send txs. setup() asserts each derives the expected address.
 */
export const TEST_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // #0 deployer/admin
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // #1 gateway/settler
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // #2 node/provider
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // #3 requester
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // #4 treasury
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // #5 outsider
] as const;

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
  // Slice 6A: the ProtocolTreasury CONTRACT is the fee recipient, like production deploys.
  const treasuryContract = await viem.deployContract('ProtocolTreasury', [
    token.address,
    deployer.account.address,
  ]);
  const treasuryAddr = treasuryContract.address;
  const registry = await viem.deployContract('NodeRegistry', [
    token.address,
    deployer.account.address,
  ]);
  const escrow = await viem.deployContract('JobEscrow', [
    token.address,
    treasuryAddr,
    deployer.account.address,
  ]);
  const credit = await viem.deployContract('CreditAccount', [
    token.address,
    treasuryAddr,
    deployer.account.address,
  ]);
  const dispute = await viem.deployContract('DisputeResolution', [
    token.address,
    registry.address,
    treasuryAddr,
    deployer.account.address,
  ]);
  // Slice 6B. Unlike deploy.ts, the fixture does NOT call treasury.setStakerPool —
  // the treasury unit tests need the parked-earmark semantics; tests that want the
  // full production wiring call setStakerPool themselves.
  const rewards = await viem.deployContract('StakingRewards', [
    token.address,
    registry.address,
    deployer.account.address,
  ]);

  // Grant gateway the operational roles.
  const REG_ORACLE = await registry.read.ORACLE_ROLE();
  const REG_SLASHER = await registry.read.SLASHER_ROLE();
  const ESC_ORACLE = await escrow.read.ORACLE_ROLE();
  const ESC_MATCHING = await escrow.read.MATCHING_ENGINE_ROLE();
  const CREDIT_SETTLER = await credit.read.SETTLER_ROLE();
  await registry.write.grantRole([REG_ORACLE, gateway.account.address]);
  await registry.write.grantRole([REG_SLASHER, gateway.account.address]);
  await escrow.write.grantRole([ESC_ORACLE, gateway.account.address]);
  await escrow.write.grantRole([ESC_MATCHING, gateway.account.address]);
  await credit.write.grantRole([CREDIT_SETTLER, gateway.account.address]);
  const DISPUTE_ORACLE = await dispute.read.ORACLE_ROLE();
  await dispute.write.grantRole([DISPUTE_ORACLE, gateway.account.address]);
  await registry.write.grantRole([REG_SLASHER, dispute.address]);
  const TREASURY_KEEPER = await treasuryContract.read.KEEPER_ROLE();
  await treasuryContract.write.grantRole([TREASURY_KEEPER, gateway.account.address]);
  const REWARDS_KEEPER = await rewards.read.KEEPER_ROLE();
  await rewards.write.grantRole([REWARDS_KEEPER, gateway.account.address]);

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
    credit,
    dispute,
    treasuryContract,
    treasuryAddr,
    rewards,
    roles: {
      REG_ORACLE,
      REG_SLASHER,
      ESC_ORACLE,
      ESC_MATCHING,
      CREDIT_SETTLER,
      DISPUTE_ORACLE,
      TREASURY_KEEPER,
      REWARDS_KEEPER,
    },
  };
}

/** Re-bind a deployed contract to a specific signer (to test role-gated calls). */
export async function as<
  N extends
    | 'QUAISToken'
    | 'NodeRegistry'
    | 'JobEscrow'
    | 'CreditAccount'
    | 'DisputeResolution'
    | 'ProtocolTreasury'
    | 'StakingRewards',
>(
  viem: Viem,
  name: N,
  address: Address,
  wallet: Awaited<ReturnType<Viem['getWalletClients']>>[number],
) {
  return viem.getContractAt(name, address, { client: { wallet } });
}

// ─── CreditAccount EIP-712 helpers (test-only, viem-native; mirror CreditAccount.sol) ─────

/** The spending-cap a requester signs. bigints are uint256 wei/seconds. */
export interface CapInput {
  requester: Address;
  settler: Address;
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** EIP-712 type — field order must match CreditAccount.SPENDING_CAP_TYPEHASH. */
export const SPENDING_CAP_TYPES = {
  SpendingCap: [
    { name: 'requester', type: 'address' },
    { name: 'settler', type: 'address' },
    { name: 'maxSpendWei', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function creditDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: 'QueraIS CreditAccount', version: '1', chainId, verifyingContract };
}

/** Sign a cap with a known dev private key (the requester's). */
export function signCap(privateKey: Hex, cap: CapInput, domain: TypedDataDomain): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
  });
}

/** The canonical viem EIP-712 digest for a cap (compared against the on-chain hash). */
export function capDigest(cap: CapInput, domain: TypedDataDomain): Hex {
  return hashTypedData({
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
  });
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
