import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, deploy, jobId } from './helpers.js';

describe('StakingRewards', async () => {
  const { viem, networkHelpers } = await network.create();

  /** Register wallets as staked nodes and fund the rewards pool with `pool` QAIS. */
  async function setup(
    stakes: Array<[wallet: 'node' | 'requester' | 'outsider', stake: bigint]>,
    pool = parseEther('100'),
  ) {
    const ctx = await deploy(viem);
    for (const [who, stake] of stakes) {
      const wallet = ctx[who];
      // requester/outsider need QAIS to stake (fixture funds node + requester only).
      await ctx.token.write.transfer([wallet.account.address, stake]);
      const token = await as(viem, 'QUAISToken', ctx.token.address, wallet);
      await token.write.approve([ctx.registry.address, stake]);
      const registry = await as(viem, 'NodeRegistry', ctx.registry.address, wallet);
      await registry.write.registerNode([jobId(`stake-${who}`), stake]);
    }
    if (pool > 0n) await ctx.token.write.transfer([ctx.rewards.address, pool]);
    const keeper = await as(viem, 'StakingRewards', ctx.rewards.address, ctx.gateway);
    return { ...ctx, keeper, pool };
  }

  const bal = (ctx: Awaited<ReturnType<typeof deploy>>, addr: `0x${string}`) =>
    ctx.token.read.balanceOf([addr]);

  it('credits pro-rata to active stakes; dust rolls to the next epoch (conservation)', async () => {
    // 300/100 split → 75%/25% of the pool.
    const ctx = await setup(
      [
        ['node', parseEther('300')],
        ['requester', parseEther('100')],
      ],
      parseEther('100'),
    );
    await ctx.keeper.write.distributeEpoch();

    assert.equal(
      await ctx.rewards.read.claimable([ctx.node.account.address]),
      parseEther('75'),
      'node: 300/400 of the pool',
    );
    assert.equal(
      await ctx.rewards.read.claimable([ctx.requester.account.address]),
      parseEther('25'),
      'requester: 100/400 of the pool',
    );
    assert.equal(await ctx.rewards.read.totalCredited(), parseEther('100'));
    assert.equal(await ctx.rewards.read.pendingRewards(), 0n, 'everything credited');

    // Indivisible pool: 100 wei over 3:1 stakes → 75 + 25, no dust here; force dust
    // with 101 wei → 75 + 25 credited, 1 wei stays pending for the next epoch.
    await ctx.token.write.transfer([ctx.rewards.address, 101n]);
    await ctx.keeper.write.distributeEpoch();
    assert.equal(await ctx.rewards.read.pendingRewards(), 1n, 'division dust rolls forward');
  });

  it('a single active node receives 100%', async () => {
    const ctx = await setup([['node', parseEther('2500')]], parseEther('40'));
    await ctx.keeper.write.distributeEpoch();
    assert.equal(await ctx.rewards.read.claimable([ctx.node.account.address]), parseEther('40'));
  });

  it('claim pays out, zeroes the balance, and rejects a second claim', async () => {
    const ctx = await setup([['node', parseEther('2500')]], parseEther('40'));
    await ctx.keeper.write.distributeEpoch();

    const asNode = await as(viem, 'StakingRewards', ctx.rewards.address, ctx.node);
    const b0 = await bal(ctx, ctx.node.account.address);
    await asNode.write.claim();
    assert.equal((await bal(ctx, ctx.node.account.address)) - b0, parseEther('40'));
    assert.equal(await ctx.rewards.read.claimable([ctx.node.account.address]), 0n);
    assert.equal(await ctx.rewards.read.totalClaimed(), parseEther('40'));
    await assert.rejects(asNode.write.claim(), /NothingToClaim/);
  });

  it('earned rewards survive a later slash and unbonding (a token debt, not stake)', async () => {
    const ctx = await setup([['node', parseEther('2500')]], parseEther('40'));
    await ctx.keeper.write.distributeEpoch();

    // Slash, then fully unbond — the credited rewards must remain claimable.
    const gwRegistry = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);
    await gwRegistry.write.slash([ctx.node.account.address, parseEther('500'), 'post-credit']);
    const nodeRegistry = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);
    await nodeRegistry.write.initiateUnbonding();
    await networkHelpers.time.increase(7 * 24 * 60 * 60 + 1);
    await nodeRegistry.write.completeUnbonding();

    const asNode = await as(viem, 'StakingRewards', ctx.rewards.address, ctx.node);
    const b0 = await bal(ctx, ctx.node.account.address);
    await asNode.write.claim();
    assert.equal((await bal(ctx, ctx.node.account.address)) - b0, parseEther('40'));
  });

  it('empty pool and zero active nodes both revert (funds wait, never strand)', async () => {
    const noPool = await setup([['node', parseEther('100')]], 0n);
    await assert.rejects(noPool.keeper.write.distributeEpoch(), /NothingToCredit/);

    const noNodes = await setup([], parseEther('10'));
    await assert.rejects(noNodes.keeper.write.distributeEpoch(), /NoActiveNodes/);
    assert.equal(await noNodes.rewards.read.pendingRewards(), parseEther('10'), 'funds wait');
  });

  it('the full 6A→6B loop: treasury sweep pays the pool, epoch credits it', async () => {
    const ctx = await setup([['node', parseEther('2500')]], 0n);
    // Wire the production link the fixture deliberately leaves open.
    await ctx.treasuryContract.write.setStakerPool([ctx.rewards.address]);
    await ctx.token.write.transfer([ctx.treasuryAddr, parseEther('1000')]); // "fees"
    const treasuryKeeper = await as(viem, 'ProtocolTreasury', ctx.treasuryAddr, ctx.gateway);
    await treasuryKeeper.write.distribute(); // 20% staker share → rewards

    assert.equal(await ctx.rewards.read.pendingRewards(), parseEther('200'));
    await ctx.keeper.write.distributeEpoch();
    assert.equal(
      await ctx.rewards.read.claimable([ctx.node.account.address]),
      parseEther('200'),
      'fee → sweep → epoch credit, conserved end-to-end',
    );
  });

  it('distributeEpoch is keeper-only', async () => {
    const ctx = await setup([['node', parseEther('100')]], parseEther('10'));
    const asOutsider = await as(viem, 'StakingRewards', ctx.rewards.address, ctx.outsider);
    await assert.rejects(asOutsider.write.distributeEpoch(), /AccessControl/);
  });
});
