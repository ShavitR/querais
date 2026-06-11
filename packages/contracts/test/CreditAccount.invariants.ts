import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, creditDomain, deploy, jobId, signCap, TEST_PRIVATE_KEYS } from './helpers.js';

/**
 * Fuzz-style invariant test: over many randomized batches, settlement must always conserve
 * value — sum(providerPay) + fee == sum(amount) — with the protocol earning exactly 5%
 * (basis-point integer math, matching on-chain), and the deposit debited by exactly the gross.
 *
 * Deterministic LCG (no Math.random) so failures are reproducible.
 */
describe('CreditAccount — settlement invariants (fuzz)', async () => {
  const { viem, networkHelpers } = await network.create();
  const REQUESTER_PK = TEST_PRIVATE_KEYS[3];

  let seed = 0x9e3779b97f4a7c15n;
  const MASK = (1n << 64n) - 1n;
  function rnd(maxExclusive: bigint): bigint {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK;
    return seed % maxExclusive;
  }

  it('conserves value across 25 randomized batches', async () => {
    const ctx = await deploy(viem);
    const chainId = await ctx.publicClient.getChainId();
    const domain = creditDomain(chainId, ctx.credit.address);
    const deposit = parseEther('900'); // requester is funded with 1000 by deploy()
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, deposit]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([deposit]);
    const creditGw = await as(viem, 'CreditAccount', ctx.credit.address, ctx.gateway);

    const feeRate = await ctx.credit.read.protocolFeeRate(); // 500
    const provider = ctx.node.account.address;
    const treasury = ctx.treasuryAddr;
    const now = await networkHelpers.time.latest();
    const cap = {
      requester: ctx.requester.account.address,
      settler: ctx.gateway.account.address,
      maxSpendWei: deposit,
      nonce: 42n,
      deadline: BigInt(now) + 36000n,
    };
    const sig = await signCap(REQUESTER_PK, cap, domain);

    let spent = 0n;
    let k = 0;
    for (let i = 0; i < 25; i++) {
      const n = 1n + rnd(4n); // 1..4 debits
      const debits: { jobId: `0x${string}`; provider: `0x${string}`; amountWei: bigint }[] = [];
      let batchTotal = 0n;
      let batchFee = 0n;
      let batchProviderPay = 0n;
      for (let j = 0n; j < n; j++) {
        const amount = 1n + rnd(parseEther('0.5'));
        const fee = (amount * BigInt(feeRate)) / 10000n;
        const providerPay = amount - fee;
        assert.equal(providerPay + fee, amount, `iter ${i}.${j}: pay+fee`);
        debits.push({ jobId: jobId(`fuzz-c-${k++}`), provider, amountWei: amount });
        batchTotal += amount;
        batchFee += fee;
        batchProviderPay += providerPay;
      }

      const provBefore = await ctx.token.read.balanceOf([provider]);
      const treasBefore = await ctx.token.read.balanceOf([treasury]);
      const balBefore = await ctx.credit.read.balanceOf([ctx.requester.account.address]);

      await creditGw.write.batchSettle([cap, sig, debits]);
      spent += batchTotal;

      assert.equal(
        await ctx.token.read.balanceOf([provider]),
        provBefore + batchProviderPay,
        `iter ${i}: provider`,
      );
      assert.equal(
        await ctx.token.read.balanceOf([treasury]),
        treasBefore + batchFee,
        `iter ${i}: treasury`,
      );
      assert.equal(
        await ctx.credit.read.balanceOf([ctx.requester.account.address]),
        balBefore - batchTotal,
        `iter ${i}: deposit debited by gross`,
      );
    }

    assert.equal(await ctx.credit.read.spentAgainst([ctx.requester.account.address, 42n]), spent);
  });
});
