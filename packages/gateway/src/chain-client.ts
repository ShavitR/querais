import {
  creditAccountAbi,
  disputeResolutionAbi,
  jobEscrowAbi,
  nodeRegistryAbi,
  quaisTokenAbi,
  type Deployment,
  type QueraisPublicClient,
  type QueraisWalletClient,
} from '@querais/shared';
import { maxUint256, type Address, type Hex } from 'viem';

/** A single payment in a batched settlement (gross; the contract splits 95/5). */
export interface BatchDebit {
  jobId: Hex;
  provider: Address;
  amountWei: bigint;
}

/** The requester's signed spending cap, as the CreditAccount expects it. */
export interface SignedCap {
  requester: Address;
  settler: Address;
  maxSpendWei: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}

/**
 * The gateway's on-chain interface. The gateway wallet holds MATCHING_ENGINE_ROLE
 * (createJob/assignJob) and ORACLE_ROLE (completeJob/verifyAndRelease/failJob and
 * reputation updates). Reads go through the public client; writes wait for receipts.
 */
export class ChainClient {
  constructor(
    private readonly publicClient: QueraisPublicClient,
    private readonly walletClient: QueraisWalletClient,
    public readonly deployment: Deployment,
  ) {}

  /**
   * Wait for a write to mine AND succeed. viem does not throw on a mined-but-reverted
   * tx — without this check a revert (e.g. cap expired between gas estimation and
   * inclusion) would be treated as settled, stranding provider payments.
   */
  private async waitForSuccess(hash: Hex, what: string): Promise<Hex> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`${what} reverted on-chain (tx ${hash})`);
    }
    return hash;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  getNode(wallet: Address) {
    return this.publicClient.readContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'getNode',
      args: [wallet],
    });
  }

  getJob(jobId: Hex) {
    return this.publicClient.readContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'getJob',
      args: [jobId],
    });
  }

  /** Latest block timestamp (seconds) — basis for job deadlines (robust to clock skew). */
  async latestBlockTimestamp(): Promise<bigint> {
    const block = await this.publicClient.getBlock();
    return block.timestamp;
  }

  tokenBalance(account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'balanceOf',
      args: [account],
    });
  }

  // ── Matching-engine writes ───────────────────────────────────────────────────
  async createJob(
    jobId: Hex,
    requester: Address,
    maxPricePerTokenWei: bigint,
    maxTokens: bigint,
    deadline: bigint,
  ): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'createJob',
      args: [jobId, requester, maxPricePerTokenWei, maxTokens, deadline],
    });
    return this.waitForSuccess(hash, 'createJob');
  }

  async assignJob(jobId: Hex, provider: Address, agreedPricePerTokenWei: bigint): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'assignJob',
      args: [jobId, provider, agreedPricePerTokenWei],
    });
    return this.waitForSuccess(hash, 'assignJob');
  }

  // ── Oracle writes (used from M5 settlement) ──────────────────────────────────
  async completeJob(jobId: Hex, actualTokens: bigint, resultHash: Hex): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'completeJob',
      args: [jobId, actualTokens, resultHash],
    });
    return this.waitForSuccess(hash, 'completeJob');
  }

  async verifyAndRelease(jobId: Hex): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'verifyAndRelease',
      args: [jobId],
    });
    return this.waitForSuccess(hash, 'verifyAndRelease');
  }

  async failJob(jobId: Hex, reason: string): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'failJob',
      args: [jobId, reason],
    });
    return this.waitForSuccess(hash, 'failJob');
  }

  async slash(wallet: Address, amount: bigint, reason: string): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'slash',
      args: [wallet, amount, reason],
    });
    return this.waitForSuccess(hash, 'slash');
  }

  async updateReputation(wallet: Address, newScore: number): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'updateReputation',
      args: [wallet, newScore],
    });
    return this.waitForSuccess(hash, 'updateReputation');
  }

  // ── CreditAccount (Slice 2 batched settlement) ───────────────────────────────
  /** Settle a batch of debits against a requester's signed cap in a single tx. */
  async batchSettle(cap: SignedCap, debits: readonly BatchDebit[]): Promise<Hex> {
    const capArg = {
      requester: cap.requester,
      settler: cap.settler,
      maxSpendWei: cap.maxSpendWei,
      nonce: cap.nonce,
      deadline: cap.deadline,
    };
    const debitArg = debits.map((d) => ({
      jobId: d.jobId,
      provider: d.provider,
      amountWei: d.amountWei,
    }));
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.creditAccount,
      abi: creditAccountAbi,
      functionName: 'batchSettle',
      args: [capArg, cap.signature, debitArg],
    });
    return this.waitForSuccess(hash, 'batchSettle');
  }

  /** A requester's deposited, unspent CreditAccount balance (wei). */
  creditBalance(requester: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.creditAccount,
      abi: creditAccountAbi,
      functionName: 'balanceOf',
      args: [requester],
    });
  }

  /** Whether a job has already been settled in some batch (idempotency guard mirror). */
  settledJob(jobId: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.creditAccount,
      abi: creditAccountAbi,
      functionName: 'settledJob',
      args: [jobId],
    });
  }

  /** Cumulative wei already settled against a requester's cap nonce. */
  spentAgainst(requester: Address, nonce: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.creditAccount,
      abi: creditAccountAbi,
      functionName: 'spentAgainst',
      args: [requester, nonce],
    });
  }

  // ── DisputeResolution (Slice 5B challenge hook) ──────────────────────────────

  /** The dispute contract's address, or undefined on pre-5B deployments. */
  disputeContract(): Address | undefined {
    return this.deployment.contracts.disputeResolution;
  }

  /** Make sure the dispute contract can pull the challenger bond from the gateway
   *  wallet (one max-approval, lazily). */
  async ensureDisputeAllowance(): Promise<void> {
    const dispute = this.requireDispute();
    const owner = this.walletClient.account.address;
    const [allowance, bond] = await Promise.all([
      this.publicClient.readContract({
        address: this.deployment.contracts.token,
        abi: quaisTokenAbi,
        functionName: 'allowance',
        args: [owner, dispute],
      }),
      this.publicClient.readContract({
        address: dispute,
        abi: disputeResolutionAbi,
        functionName: 'CHALLENGER_BOND',
      }),
    ]);
    if (allowance >= bond) return;
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'approve',
      args: [dispute, maxUint256],
    });
    await this.waitForSuccess(hash, 'approve(dispute bond)');
  }

  /** Raise a dispute against a provider, posting the challenger bond. */
  async raiseDispute(jobId: Hex, defendant: Address, evidenceHash: Hex): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.requireDispute(),
      abi: disputeResolutionAbi,
      functionName: 'raiseDispute',
      args: [jobId, defendant, evidenceHash],
    });
    return this.waitForSuccess(hash, 'raiseDispute');
  }

  /** FAST-track oracle resolution (the oracle's re-run confirmed the outcome). */
  async autoResolveDispute(jobId: Hex, challengerWins: boolean): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.requireDispute(),
      abi: disputeResolutionAbi,
      functionName: 'autoResolve',
      args: [jobId, challengerWins],
    });
    return this.waitForSuccess(hash, 'autoResolve');
  }

  private requireDispute(): Address {
    const address = this.deployment.contracts.disputeResolution;
    if (!address) {
      throw new Error('this deployment has no DisputeResolution contract (pre-5B manifest)');
    }
    return address;
  }
}
