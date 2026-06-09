/**
 * EIP-712 spending cap — the off-chain authorization a requester signs once per session
 * so the gateway can batch-settle many jobs against a pre-funded CreditAccount balance
 * without a per-call wallet tx. The struct and domain MUST match CreditAccount.sol exactly
 * (SPENDING_CAP_TYPEHASH + EIP712("QueraIS CreditAccount", "1")), so the digest the
 * requester signs is the one the contract recovers.
 */
import {
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

/** Mirrors CreditAccount.SpendingCap. bigints are uint256 wei/seconds. */
export interface SpendingCap {
  requester: Address;
  settler: Address;
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** EIP-712 type definition — field order must match SPENDING_CAP_TYPEHASH. */
export const SPENDING_CAP_TYPES = {
  SpendingCap: [
    { name: 'requester', type: 'address' },
    { name: 'settler', type: 'address' },
    { name: 'maxSpendWei', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const SPENDING_CAP_DOMAIN_NAME = 'QueraIS CreditAccount';
export const SPENDING_CAP_DOMAIN_VERSION = '1';

/** Build the EIP-712 domain for a CreditAccount deployment. */
export function spendingCapDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return {
    name: SPENDING_CAP_DOMAIN_NAME,
    version: SPENDING_CAP_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/** Minimal shape a signer must expose (viem LocalAccount / WalletClient both satisfy it). */
export interface TypedDataSigner {
  signTypedData(args: {
    domain: TypedDataDomain;
    types: typeof SPENDING_CAP_TYPES;
    primaryType: 'SpendingCap';
    message: SpendingCap;
  }): Promise<Hex>;
}

/** Sign a spending cap with a viem account/wallet client. Returns the 65-byte signature. */
export function signSpendingCap(
  signer: TypedDataSigner,
  cap: SpendingCap,
  domain: TypedDataDomain,
): Promise<Hex> {
  return signer.signTypedData({
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
  });
}

/** The EIP-712 digest for a cap — must equal CreditAccount.hashSpendingCap(cap) on-chain. */
export function hashSpendingCap(cap: SpendingCap, domain: TypedDataDomain): Hex {
  return hashTypedData({
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
  });
}

/** Recover the signer address from a cap + signature (mirrors ECDSA.recover on-chain). */
export function recoverSpendingCapSigner(
  cap: SpendingCap,
  domain: TypedDataDomain,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
    signature,
  });
}

/**
 * Wire schema for a signed cap as sent to the gateway (`POST /v1/sessions`). bigints are
 * carried as decimal strings; `toSpendingCap` parses them back. Addresses are lowercased
 * 0x-hex; the signature is 0x-hex.
 */
const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimalString = z.string().regex(/^[0-9]+$/);

export const signedSpendingCapSchema = z.object({
  requester: hexAddress,
  settler: hexAddress,
  maxSpendWei: decimalString,
  nonce: decimalString,
  deadline: decimalString,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export type SignedSpendingCapWire = z.infer<typeof signedSpendingCapSchema>;

/** Parse the wire form into a typed cap + signature (bigints decoded). */
export function toSpendingCap(wire: SignedSpendingCapWire): { cap: SpendingCap; signature: Hex } {
  return {
    cap: {
      requester: wire.requester as Address,
      settler: wire.settler as Address,
      maxSpendWei: BigInt(wire.maxSpendWei),
      nonce: BigInt(wire.nonce),
      deadline: BigInt(wire.deadline),
    },
    signature: wire.signature as Hex,
  };
}

/** Everything needed to build + sign a session cap from a private key (the SDK's view). */
export interface BuildSessionParams {
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
  settler: Address;
  chainId: number;
  verifyingContract: Address;
}

/**
 * Build, sign, and serialize a spending cap from a private key — the one call the SDK makes
 * to open a session. The requester is derived from the key; the result is POSTed to
 * `/v1/sessions`. Keeps all signing in `shared` so the SDK needs no viem dependency.
 */
export async function buildSignedSession(
  privateKey: Hex,
  p: BuildSessionParams,
): Promise<SignedSpendingCapWire> {
  const account = privateKeyToAccount(privateKey);
  const cap: SpendingCap = {
    requester: account.address,
    settler: p.settler,
    maxSpendWei: p.maxSpendWei,
    nonce: p.nonce,
    deadline: p.deadline,
  };
  const domain = spendingCapDomain(p.chainId, p.verifyingContract);
  const signature = await signSpendingCap(account, cap, domain);
  return toSignedSpendingCapWire(cap, signature);
}

/** Serialize a typed cap + signature into the wire form (bigints → decimal strings). */
export function toSignedSpendingCapWire(cap: SpendingCap, signature: Hex): SignedSpendingCapWire {
  return {
    requester: cap.requester,
    settler: cap.settler,
    maxSpendWei: cap.maxSpendWei.toString(),
    nonce: cap.nonce.toString(),
    deadline: cap.deadline.toString(),
    signature,
  };
}
