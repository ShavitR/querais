import {
  creditAccountAbi,
  disputeResolutionAbi,
  jobEscrowAbi,
  nodeRegistryAbi,
  protocolTreasuryAbi,
  stakingRewardsAbi,
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

/** A read-only view of a job's on-chain dispute (Slice 10C). */
export interface DisputeView {
  jobId: Hex;
  /** none | open | countered | resolved (the contract's DisputeStatus). */
  status: string;
  challenger: Address;
  defendant: Address;
  bondWei: string;
  evidenceHash: Hex;
  counterEvidenceHash: Hex;
  raisedAt: number;
  /** raisedAt + the contract's 24h COUNTER_EVIDENCE_WINDOW (unix seconds). */
  counterEvidenceDeadline: number;
  challengerWon: boolean;
}

const DISPUTE_STATUS = ['none', 'open', 'countered', 'resolved'] as const;

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

  /** Native ETH balance — gas-tank reads for the `gas-low` / `faucet-low` sweeps. */
  ethBalance(account: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address: account });
  }

  tokenBalance(account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'balanceOf',
      args: [account],
    });
  }

  /** Current $QAIS supply (shrinks as the treasury burns; Slice 10D economics panel). */
  totalSupply(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'totalSupply',
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

  /** Read a job's dispute (Slice 10C); null when none exists (status NONE). The public
   *  mapping getter flattens the struct — decode positionally OR by name (viem differs). */
  async getDispute(jobId: Hex): Promise<DisputeView | null> {
    const raw = (await this.publicClient.readContract({
      address: this.requireDispute(),
      abi: disputeResolutionAbi,
      functionName: 'disputes',
      args: [jobId],
    })) as unknown;
    // The flattened mapping getter comes back as a positional tuple OR a named object
    // depending on viem's decoding — normalize both into one shape.
    type Obj = {
      challenger: Address;
      defendant: Address;
      bond: bigint;
      evidenceHash: Hex;
      counterEvidenceHash: Hex;
      raisedAt: bigint;
      status: number;
      challengerWon: boolean;
    };
    const f: Obj = Array.isArray(raw)
      ? {
          challenger: raw[0] as Address,
          defendant: raw[1] as Address,
          bond: raw[2] as bigint,
          evidenceHash: raw[3] as Hex,
          counterEvidenceHash: raw[4] as Hex,
          raisedAt: raw[5] as bigint,
          status: raw[6] as number,
          challengerWon: raw[7] as boolean,
        }
      : (raw as Obj);
    const status = Number(f.status);
    if (status === 0) return null; // NONE — no dispute for this job
    const raisedAt = Number(f.raisedAt);
    return {
      jobId,
      status: DISPUTE_STATUS[status] ?? 'unknown',
      challenger: f.challenger,
      defendant: f.defendant,
      bondWei: f.bond.toString(),
      evidenceHash: f.evidenceHash,
      counterEvidenceHash: f.counterEvidenceHash,
      raisedAt,
      counterEvidenceDeadline: raisedAt + 24 * 3600,
      challengerWon: f.challengerWon,
    };
  }

  /** Disputes raised against `defendant` (Slice 10C operator panel), via DisputeRaised logs.
   *  Scans from genesis — bounded by how rare disputes are; fine for testnet volumes. */
  async disputesAgainst(defendant: Address): Promise<DisputeView[]> {
    if (!this.deployment.contracts.disputeResolution) return [];
    const logs = await this.publicClient.getContractEvents({
      address: this.requireDispute(),
      abi: disputeResolutionAbi,
      eventName: 'DisputeRaised',
      args: { defendant },
      fromBlock: 'earliest',
    });
    const jobIds = [
      ...new Set(
        logs.map((l) => (l.args as { jobId?: Hex }).jobId).filter((j): j is Hex => Boolean(j)),
      ),
    ];
    const out: DisputeView[] = [];
    for (const jobId of jobIds) {
      const d = await this.getDispute(jobId);
      if (d) out.push(d);
    }
    return out;
  }

  private requireDispute(): Address {
    const address = this.deployment.contracts.disputeResolution;
    if (!address) {
      throw new Error('this deployment has no DisputeResolution contract (pre-5B manifest)');
    }
    return address;
  }

  // ── ProtocolTreasury (Slice 6A keeper) ───────────────────────────────────────

  /** The treasury contract's address, or undefined on pre-6A deployments. */
  treasuryContract(): Address | undefined {
    return this.deployment.contracts.protocolTreasury;
  }

  /** Fees accrued since the last sweep (the keeper reads before writing). */
  treasuryPending(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.requireTreasury(),
      abi: protocolTreasuryAbi,
      functionName: 'pendingDistribution',
    });
  }

  /** Execute the daily 60/20/20 sweep (receipt-checked like every chain write). */
  async distributeTreasury(): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.requireTreasury(),
      abi: protocolTreasuryAbi,
      functionName: 'distribute',
    });
    return this.waitForSuccess(hash, 'distribute');
  }

  private requireTreasury(): Address {
    const address = this.deployment.contracts.protocolTreasury;
    if (!address) {
      throw new Error('this deployment has no ProtocolTreasury contract (pre-6A manifest)');
    }
    return address;
  }

  // ── StakingRewards (Slice 6B keeper) ─────────────────────────────────────────

  /** The staking-rewards contract's address, or undefined on pre-6B deployments. */
  stakingRewardsContract(): Address | undefined {
    return this.deployment.contracts.stakingRewards;
  }

  /** Staker-share funds awaiting the pro-rata epoch credit. */
  rewardsPending(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.requireRewards(),
      abi: stakingRewardsAbi,
      functionName: 'pendingRewards',
    });
  }

  /** Credit pending rewards pro-rata to the active staked nodes (receipt-checked). */
  async distributeRewardsEpoch(): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.requireRewards(),
      abi: stakingRewardsAbi,
      functionName: 'distributeEpoch',
    });
    return this.waitForSuccess(hash, 'distributeEpoch');
  }

  /** A node operator's earned, unclaimed rewards. */
  claimableRewards(wallet: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.requireRewards(),
      abi: stakingRewardsAbi,
      functionName: 'claimable',
      args: [wallet],
    });
  }

  private requireRewards(): Address {
    const address = this.deployment.contracts.stakingRewards;
    if (!address) {
      throw new Error('this deployment has no StakingRewards contract (pre-6B manifest)');
    }
    return address;
  }

  // ── Incentive recommendation reads (Slice 6C — ops, no writes) ───────────────

  /** Enumerate the registry's active node wallets. */
  async activeNodeWallets(): Promise<Address[]> {
    const count = await this.publicClient.readContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'activeNodeCount',
    });
    const wallets: Address[] = [];
    for (let i = 0n; i < count; i++) {
      wallets.push(
        await this.publicClient.readContract({
          address: this.deployment.contracts.nodeRegistry,
          abi: nodeRegistryAbi,
          functionName: 'activeNodeAt',
          args: [i],
        }),
      );
    }
    return wallets;
  }

  /** Every allocate() purpose string ever paid — the one-time-bonus dedup ledger
   *  (derived from chain events; the gateway keeps no payout table). */
  async allocatedPurposes(): Promise<string[]> {
    const treasury = this.deployment.contracts.protocolTreasury;
    if (!treasury) return [];
    const events = await this.publicClient.getContractEvents({
      address: treasury,
      abi: protocolTreasuryAbi,
      eventName: 'Allocated',
      fromBlock: 'earliest',
    });
    return events.map((e) => (e.args as { purpose?: string }).purpose ?? '');
  }

  /** The treasury's spendable ops share (allocate() reverts beyond this). */
  treasuryOpsRetained(): Promise<bigint> {
    const treasury = this.deployment.contracts.protocolTreasury;
    if (!treasury) return Promise.resolve(0n);
    return this.publicClient.readContract({
      address: treasury,
      abi: protocolTreasuryAbi,
      functionName: 'opsRetainedWei',
    });
  }
}
