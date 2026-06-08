import {
  jobEscrowAbi,
  nodeRegistryAbi,
  quaisTokenAbi,
  type Deployment,
  type QueraisPublicClient,
  type QueraisWalletClient,
} from '@querais/shared';
import type { Address, Hex } from 'viem';

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
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async assignJob(jobId: Hex, provider: Address, agreedPricePerTokenWei: bigint): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'assignJob',
      args: [jobId, provider, agreedPricePerTokenWei],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ── Oracle writes (used from M5 settlement) ──────────────────────────────────
  async completeJob(jobId: Hex, actualTokens: bigint, resultHash: Hex): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'completeJob',
      args: [jobId, actualTokens, resultHash],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async verifyAndRelease(jobId: Hex): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'verifyAndRelease',
      args: [jobId],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async failJob(jobId: Hex, reason: string): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'failJob',
      args: [jobId, reason],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async slash(wallet: Address, amount: bigint, reason: string): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'slash',
      args: [wallet, amount, reason],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async updateReputation(wallet: Address, newScore: number): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: this.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'updateReputation',
      args: [wallet, newScore],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}
