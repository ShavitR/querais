import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, deploy } from './helpers.js';

describe('ProtocolTreasury', async () => {
  const { viem } = await network.create();

  /** Fund the treasury with `fees` (simulating accrued settlement fees) and return a
   *  keeper-bound handle. */
  async function setup(fees = parseEther('1000')) {
    const ctx = await deploy(viem);
    if (fees > 0n) await ctx.token.write.transfer([ctx.treasuryAddr, fees]);
    const keeper = await as(viem, 'ProtocolTreasury', ctx.treasuryAddr, ctx.gateway);
    return { ...ctx, keeper, fees };
  }

  const bal = (ctx: Awaited<ReturnType<typeof deploy>>, addr: `0x${string}`) =>
    ctx.token.read.balanceOf([addr]);

  it('distribute splits 20/20/60 burn/staker/ops and conserves to the wei', async () => {
    const ctx = await setup(parseEther('1000'));
    const supply0 = await ctx.token.read.totalSupply();

    await ctx.keeper.write.distribute();

    const burn = parseEther('200');
    const stakerShare = parseEther('200');
    const ops = parseEther('600');
    assert.equal(supply0 - (await ctx.token.read.totalSupply()), burn, '20% burned');
    assert.equal(
      await ctx.treasuryContract.read.stakerEarmarkWei(),
      stakerShare,
      'staker 20% parks in the earmark (no pool yet — 6B)',
    );
    assert.equal(
      await bal(ctx, ctx.treasuryAddr),
      stakerShare + ops,
      'balance = earmark + retained ops',
    );
    assert.equal(burn + stakerShare + ops, ctx.fees, 'conservation: every fee wei accounted');
    assert.equal(await ctx.treasuryContract.read.totalDistributed(), ctx.fees);
    assert.equal(await ctx.treasuryContract.read.totalBurned(), burn);
    assert.equal(await ctx.treasuryContract.read.totalToStakers(), stakerShare);
  });

  it('a sweep never re-splits what earlier sweeps kept; the earmark accumulates', async () => {
    const ctx = await setup(parseEther('100'));
    await ctx.keeper.write.distribute(); // earmark 20, ops 60
    assert.equal(
      await ctx.treasuryContract.read.pendingDistribution(),
      0n,
      'retained ops + earmark are NOT pending — only new fees are',
    );
    await assert.rejects(ctx.keeper.write.distribute(), /NothingToDistribute/);

    await ctx.token.write.transfer([ctx.treasuryAddr, parseEther('100')]);
    assert.equal(
      await ctx.treasuryContract.read.pendingDistribution(),
      parseEther('100'),
      'exactly the newly arrived fees',
    );
    await ctx.keeper.write.distribute();
    assert.equal(await ctx.treasuryContract.read.stakerEarmarkWei(), parseEther('40'));
    assert.equal(await ctx.treasuryContract.read.opsRetainedWei(), parseEther('120'));
    assert.equal(await ctx.treasuryContract.read.totalBurned(), parseEther('40'));
    // Invariant: the balance is fully explained by earmark + retained ops.
    assert.equal(
      await bal(ctx, ctx.treasuryAddr),
      parseEther('40') + parseEther('120'),
      'balance == earmark + ops (nothing untracked)',
    );
  });

  it('distribute with nothing pending reverts (the keeper reads first)', async () => {
    const ctx = await setup(0n);
    await assert.rejects(ctx.keeper.write.distribute(), /NothingToDistribute/);
  });

  it('allocate spends ops but can never dip into the staker earmark', async () => {
    const ctx = await setup(parseEther('1000'));
    await ctx.keeper.write.distribute(); // earmark 200, ops 600

    const r0 = await bal(ctx, ctx.outsider.account.address);
    await ctx.treasuryContract.write.allocate([
      ctx.outsider.account.address,
      parseEther('600'),
      'node incentive program',
    ]);
    assert.equal((await bal(ctx, ctx.outsider.account.address)) - r0, parseEther('600'));
    assert.equal(await ctx.treasuryContract.read.totalAllocated(), parseEther('600'));

    // Only the earmark remains — even 1 wei more must revert.
    await assert.rejects(
      ctx.treasuryContract.write.allocate([ctx.outsider.account.address, 1n, 'overreach']),
      /ExceedsSpendable/,
    );
  });

  it('setStakerPool flushes the parked earmark; later sweeps pay the pool directly', async () => {
    const ctx = await setup(parseEther('1000'));
    await ctx.keeper.write.distribute(); // earmark 200

    const pool = ctx.outsider.account.address; // stand-in for the 6B pool
    await ctx.treasuryContract.write.setStakerPool([pool]);
    assert.equal(await bal(ctx, pool), parseEther('200'), 'earmark flushed on wiring');
    assert.equal(await ctx.treasuryContract.read.stakerEarmarkWei(), 0n);

    await ctx.token.write.transfer([ctx.treasuryAddr, parseEther('100')]);
    await ctx.keeper.write.distribute();
    assert.equal(
      await bal(ctx, pool),
      parseEther('200') + parseEther('20'),
      'subsequent staker shares transfer directly',
    );
  });

  it('setRates enforces burn + staker <= 10000 and applies to the next sweep', async () => {
    const ctx = await setup(parseEther('100'));
    await assert.rejects(ctx.treasuryContract.write.setRates([8000, 2001]), /RatesExceedTotal/);
    await ctx.treasuryContract.write.setRates([5000, 5000]); // boundary: exactly 10000
    const supply0 = await ctx.token.read.totalSupply();
    await ctx.keeper.write.distribute();
    assert.equal(supply0 - (await ctx.token.read.totalSupply()), parseEther('50'));
    assert.equal(await ctx.treasuryContract.read.stakerEarmarkWei(), parseEther('50'));
  });

  it('distribute is keeper-only; allocate/setRates/setStakerPool are admin-only', async () => {
    const ctx = await setup(parseEther('100'));
    const asOutsider = await as(viem, 'ProtocolTreasury', ctx.treasuryAddr, ctx.outsider);
    await assert.rejects(asOutsider.write.distribute(), /AccessControl/);
    await assert.rejects(
      asOutsider.write.allocate([ctx.outsider.account.address, 1n, 'theft']),
      /AccessControl/,
    );
    await assert.rejects(asOutsider.write.setRates([0, 0]), /AccessControl/);
    await assert.rejects(
      asOutsider.write.setStakerPool([ctx.outsider.account.address]),
      /AccessControl/,
    );
  });
});
