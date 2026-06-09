import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, creditDomain, deploy, jobId, signCap, TEST_PRIVATE_KEYS } from './helpers.js';

/**
 * Gas-per-job benchmark — the whole point of Slice 2. Settling N jobs in a single
 * batchSettle tx should cost far less per job than the per-job JobEscrow path
 * (createJob + assignJob + completeJob + verifyAndRelease ≈ 4 txs, hundreds of k gas each).
 * We assert one tx settles all N and amortized gas/job stays low, and print the numbers.
 */
describe('CreditAccount — gas benchmark', async () => {
  const { viem, networkHelpers } = await network.create();
  const REQUESTER_PK = TEST_PRIVATE_KEYS[3];
  const N = 20;

  it(`settles ${N} jobs in one tx with low amortized gas`, async () => {
    const ctx = await deploy(viem);
    const chainId = await ctx.publicClient.getChainId();
    const domain = creditDomain(chainId, ctx.credit.address);
    const deposit = parseEther('100');
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, deposit]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([deposit]);
    const creditGw = await as(viem, 'CreditAccount', ctx.credit.address, ctx.gateway);

    const now = await networkHelpers.time.latest();
    const cap = {
      requester: ctx.requester.account.address,
      settler: ctx.gateway.account.address,
      maxSpendWei: deposit,
      nonce: 1n,
      deadline: BigInt(now) + 3600n,
    };
    const sig = await signCap(REQUESTER_PK, cap, domain);
    const provider = ctx.node.account.address;
    const debits = Array.from({ length: N }, (_, i) => ({
      jobId: jobId(`gas-${i}`),
      provider,
      amountWei: parseEther('0.1'),
    }));

    const hash = await creditGw.write.batchSettle([cap, sig, debits]);
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    const gasPerJob = receipt.gasUsed / BigInt(N);

    console.log(
      `   batchSettle(${N}) gasUsed=${receipt.gasUsed} → ${gasPerJob} gas/job (1 tx, 0 requester txs)`,
    );

    // All N settled in this single tx.
    assert.equal(await ctx.credit.read.settledJob([jobId(`gas-${N - 1}`)]), true);
    assert.equal(
      await ctx.credit.read.spentAgainst([ctx.requester.account.address, 1n]),
      parseEther('2'),
    );
    // Amortized cost well under a single per-job escrow settlement (generous ceiling).
    assert.ok(gasPerJob < 80_000n, `gas/job ${gasPerJob} should be < 80000`);
  });
});
