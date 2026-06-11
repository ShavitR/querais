import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, deploy, jobId } from './helpers.js';

/**
 * Fuzz-style invariant test: over many randomized (price, tokens) combinations the
 * settlement must always conserve value —
 *   providerPay + fee == actualPayment   and   actualPayment + refund == locked —
 * with the protocol earning exactly 5% (basis-point integer math, matching on-chain).
 *
 * Uses a deterministic LCG (no Math.random) so failures are reproducible.
 */
describe('JobEscrow — settlement invariants (fuzz)', async () => {
  const { viem, networkHelpers } = await network.create();

  let seed = 0x9e3779b97f4a7c15n;
  const MASK = (1n << 64n) - 1n;
  function rnd(maxExclusive: bigint): bigint {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & MASK;
    return seed % maxExclusive;
  }

  it('conserves value across 30 randomized jobs', async () => {
    const ctx = await deploy(viem);
    const escGw = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.gateway);
    // Approve generously once; each job pulls its own lock.
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.escrow.address, parseEther('100000')]);

    const feeRate = await ctx.escrow.read.protocolFeeRate(); // 500
    const provider = ctx.node.account.address;
    const treasury = ctx.treasuryAddr;
    const requester = ctx.requester.account.address;

    for (let i = 0; i < 30; i++) {
      const maxTokens = 1n + rnd(1000n);
      const maxPrice = 1n + rnd(parseEther('0.001'));
      const agreed = 1n + rnd(maxPrice); // <= maxPrice
      const actual = 1n + rnd(maxTokens); // <= maxTokens, > 0

      const locked = maxPrice * maxTokens;
      const actualPayment = agreed * actual;
      const fee = (actualPayment * BigInt(feeRate)) / 10000n;
      const providerPay = actualPayment - fee;
      const refund = locked - actualPayment;

      // Pure-math invariants
      assert.equal(providerPay + fee, actualPayment, `iter ${i}: pay+fee`);
      assert.equal(actualPayment + refund, locked, `iter ${i}: payment+refund`);
      assert.ok(actualPayment <= locked, `iter ${i}: payment<=locked`);

      const id = jobId(`fuzz-${i}`);
      const now = await networkHelpers.time.latest();
      await escGw.write.createJob([id, requester, maxPrice, maxTokens, BigInt(now) + 3600n]);
      await escGw.write.assignJob([id, provider, agreed]);
      await escGw.write.completeJob([id, actual, jobId(`fuzz-r-${i}`)]);

      const provBefore = await ctx.token.read.balanceOf([provider]);
      const treasBefore = await ctx.token.read.balanceOf([treasury]);
      const reqBefore = await ctx.token.read.balanceOf([requester]);

      await escGw.write.verifyAndRelease([id]);

      assert.equal(
        await ctx.token.read.balanceOf([provider]),
        provBefore + providerPay,
        `iter ${i}: provider`,
      );
      assert.equal(
        await ctx.token.read.balanceOf([treasury]),
        treasBefore + fee,
        `iter ${i}: treasury`,
      );
      assert.equal(
        await ctx.token.read.balanceOf([requester]),
        reqBefore + refund,
        `iter ${i}: requester refund`,
      );
    }
  });
});
