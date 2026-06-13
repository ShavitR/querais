/**
 * Thin wrapper over the injected browser wallet (EIP-1193 `window.ethereum`) using viem.
 * Keeps all wallet/chain interaction in one place: connect, chain-guard, sign (SIWE message
 * + EIP-712 cap), and the credit-flow contract reads/writes. No wallet ⇒ the rest of the app
 * is unaffected (the credit view degrades gracefully).
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { creditAccountAbi, erc20Abi, SPENDING_CAP_TYPES, type SpendingCap } from './contracts';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

function provider(): EIP1193Provider {
  if (!window.ethereum) throw new Error('No browser wallet found (install MetaMask).');
  return window.ethereum;
}

function clients() {
  const transport = custom(provider());
  return { wallet: createWalletClient({ transport }), pub: createPublicClient({ transport }) };
}

export interface Connected {
  address: Address;
  chainId: number;
}

export async function connect(): Promise<Connected> {
  const p = provider();
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new Error('No account authorized.');
  const address = getAddress(accounts[0]); // EIP-55 checksum (EIP-4361 requires it)
  const chainId = Number((await p.request({ method: 'eth_chainId' })) as string);
  return { address, chainId };
}

/** Make sure the wallet is on `chainId`, prompting a switch if not. */
export async function ensureChain(chainId: number): Promise<void> {
  const p = provider();
  const current = Number((await p.request({ method: 'eth_chainId' })) as string);
  if (current === chainId) return;
  try {
    await p.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch {
    throw new Error(`Switch your wallet to chain ${chainId} and retry.`);
  }
}

export function signMessage(account: Address, message: string): Promise<Hex> {
  return clients().wallet.signMessage({ account, message });
}

export function signCap(account: Address, domain: TypedDataDomain, cap: SpendingCap): Promise<Hex> {
  return clients().wallet.signTypedData({
    account,
    domain,
    types: SPENDING_CAP_TYPES,
    primaryType: 'SpendingCap',
    message: cap,
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────
export function tokenBalance(token: Address, owner: Address): Promise<bigint> {
  return clients().pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  });
}

export function allowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return clients().pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  });
}

export function creditBalance(creditAccount: Address, owner: Address): Promise<bigint> {
  return clients().pub.readContract({
    address: creditAccount,
    abi: creditAccountAbi,
    functionName: 'balanceOf',
    args: [owner],
  });
}

export async function withdrawableAt(creditAccount: Address, owner: Address): Promise<number> {
  const at = await clients().pub.readContract({
    address: creditAccount,
    abi: creditAccountAbi,
    functionName: 'withdrawableAt',
    args: [owner],
  });
  return Number(at);
}

// ─── Writes (send tx, wait for the receipt) ──────────────────────────────────
async function send(hashPromise: Promise<Hex>): Promise<Hex> {
  const hash = await hashPromise;
  await clients().pub.waitForTransactionReceipt({ hash });
  return hash;
}

export function approve(
  account: Address,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<Hex> {
  return send(
    clients().wallet.writeContract({
      account,
      chain: null,
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
    }),
  );
}

export function deposit(account: Address, creditAccount: Address, amount: bigint): Promise<Hex> {
  return send(
    clients().wallet.writeContract({
      account,
      chain: null,
      address: creditAccount,
      abi: creditAccountAbi,
      functionName: 'deposit',
      args: [amount],
    }),
  );
}

export function initiateWithdrawal(account: Address, creditAccount: Address): Promise<Hex> {
  return send(
    clients().wallet.writeContract({
      account,
      chain: null,
      address: creditAccount,
      abi: creditAccountAbi,
      functionName: 'initiateWithdrawal',
      args: [],
    }),
  );
}

export function completeWithdrawal(account: Address, creditAccount: Address): Promise<Hex> {
  return send(
    clients().wallet.writeContract({
      account,
      chain: null,
      address: creditAccount,
      abi: creditAccountAbi,
      functionName: 'completeWithdrawal',
      args: [],
    }),
  );
}
