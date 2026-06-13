/**
 * Minimal on-chain surface the credit view touches, inlined to keep the browser bundle
 * viem-only (importing `@querais/shared` would transitively pull `@querais/contracts`, whose
 * `loadAddresses` uses `node:fs`). The EIP-712 cap type/domain MUST stay byte-identical to
 * `packages/shared/src/spending-cap.ts` + `CreditAccount.sol` — the gateway recovers the
 * signer on-chain, so any drift fails there loudly.
 */
import type { Address } from 'viem';

/** QUAISToken — only what deposit needs. */
export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** CreditAccount — deposit / withdraw + the two balance reads the UI shows. */
export const creditAccountAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'initiateWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'completeWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'requester', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdrawableAt',
    stateMutability: 'view',
    inputs: [{ name: 'requester', type: 'address' }],
    outputs: [{ type: 'uint64' }],
  },
] as const;

/** EIP-712 spending-cap type — field order must match SPENDING_CAP_TYPEHASH. */
export const SPENDING_CAP_TYPES = {
  SpendingCap: [
    { name: 'requester', type: 'address' },
    { name: 'settler', type: 'address' },
    { name: 'maxSpendWei', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface SpendingCap {
  requester: Address;
  settler: Address;
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
}

export function spendingCapDomain(chainId: number, verifyingContract: Address) {
  return {
    name: 'QueraIS CreditAccount',
    version: '1',
    chainId,
    verifyingContract,
  } as const;
}
