import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as, deploy, jobId } from './helpers.js';

const BRONZE = parseEther('100');
const GOLD = parseEther('2500');
const PLATINUM = parseEther('10000');

describe('NodeRegistry', async () => {
  const { viem, networkHelpers } = await network.create();

  /** Register `wallet` as a node staking `stake`, handling the approve. */
  async function register(
    ctx: Awaited<ReturnType<typeof deploy>>,
    wallet: (typeof ctx.wallets)[number],
    stake: bigint,
    label: string,
  ) {
    const token = await as(viem, 'QUAISToken', ctx.token.address, wallet);
    await token.write.approve([ctx.registry.address, stake]);
    const reg = await as(viem, 'NodeRegistry', ctx.registry.address, wallet);
    await reg.write.registerNode([jobId(label), stake]);
    return reg;
  }

  it('registers a node: stake pulled, reputation 0.70, tier set, listed active', async () => {
    const ctx = await deploy(viem);
    await register(ctx, ctx.node, GOLD, 'n-gold');

    const info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.exists, true);
    assert.equal(info.isActive, true);
    assert.equal(info.stakeAmount, GOLD);
    assert.equal(info.reputationScore, 7000);
    assert.equal(info.tier, 2); // Gold
    assert.equal(await ctx.token.read.balanceOf([ctx.registry.address]), GOLD);
    assert.equal(await ctx.registry.read.totalStaked(), GOLD);

    const eligible = await ctx.registry.read.getEligibleNodes([0]);
    assert.deepEqual(
      eligible.map((a) => a.toLowerCase()),
      [ctx.node.account.address.toLowerCase()],
    );
  });

  it('rejects sub-minimum stake, double registration, and duplicate node ids', async () => {
    const ctx = await deploy(viem);
    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, parseEther('5000')]);
    const regNode = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);

    await viem.assertions.revertWithCustomError(
      regNode.write.registerNode([jobId('too-small'), parseEther('99')]),
      ctx.registry,
      'StakeBelowMinimum',
    );

    await regNode.write.registerNode([jobId('dup-id'), BRONZE]);
    await viem.assertions.revertWithCustomError(
      regNode.write.registerNode([jobId('other'), BRONZE]),
      ctx.registry,
      'AlreadyRegistered',
    );

    // another wallet reusing the same nodeId
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.registry.address, BRONZE]);
    const regReq = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.requester);
    await viem.assertions.revertWithCustomError(
      regReq.write.registerNode([jobId('dup-id'), BRONZE]),
      ctx.registry,
      'NodeIdTaken',
    );
  });

  it('addStake increases stake and promotes tier (Bronze -> Gold)', async () => {
    const ctx = await deploy(viem);
    const regNode = await register(ctx, ctx.node, BRONZE, 'climb');
    let info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.tier, 0);

    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, GOLD - BRONZE]);
    await regNode.write.addStake([GOLD - BRONZE]);

    info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.stakeAmount, GOLD);
    assert.equal(info.tier, 2);
  });

  it('reaches Platinum tier at the top threshold', async () => {
    const ctx = await deploy(viem);
    // deployer holds the bulk of supply — use it for a 10k stake.
    await register(ctx, ctx.deployer, PLATINUM, 'plat');
    const info = await ctx.registry.read.getNode([ctx.deployer.account.address]);
    assert.equal(info.tier, 3);
  });

  it('updateReputation is oracle-gated and bounded', async () => {
    const ctx = await deploy(viem);
    await register(ctx, ctx.node, GOLD, 'rep');

    // outsider cannot update
    const regOut = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.outsider);
    await viem.assertions.revertWithCustomError(
      regOut.write.updateReputation([ctx.node.account.address, 9000]),
      ctx.registry,
      'AccessControlUnauthorizedAccount',
    );

    // gateway (oracle) can, within bounds
    const regGw = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);
    await regGw.write.updateReputation([ctx.node.account.address, 9500]);
    assert.equal(
      (await ctx.registry.read.getNode([ctx.node.account.address])).reputationScore,
      9500,
    );

    await viem.assertions.revertWithCustomError(
      regGw.write.updateReputation([ctx.node.account.address, 10001]),
      ctx.registry,
      'InvalidReputation',
    );
  });

  it('slash reduces stake; a sub-minimum slash suspends the node', async () => {
    const ctx = await deploy(viem);
    await register(ctx, ctx.node, GOLD, 'slash');
    const regGw = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);

    // partial slash keeps the node active
    await regGw.write.slash([ctx.node.account.address, parseEther('100'), 'minor']);
    let info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.stakeAmount, GOLD - parseEther('100'));
    assert.equal(info.isActive, true);

    // slash below the bronze minimum suspends + delists
    await regGw.write.slash([
      ctx.node.account.address,
      info.stakeAmount - parseEther('50'),
      'major',
    ]);
    info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.isActive, false);
    assert.notEqual(info.suspendedAt, 0n);
    assert.equal(await ctx.registry.read.activeNodeCount(), 0n);

    // outsider cannot slash; over-slash reverts
    const regOut = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.outsider);
    await viem.assertions.revertWithCustomError(
      regOut.write.slash([ctx.node.account.address, 1n, 'x']),
      ctx.registry,
      'AccessControlUnauthorizedAccount',
    );
    await viem.assertions.revertWithCustomError(
      regGw.write.slash([ctx.node.account.address, parseEther('9999'), 'x']),
      ctx.registry,
      'AmountExceedsStake',
    );
  });

  it('a suspended node reactivates by adding stake back above the minimum', async () => {
    const ctx = await deploy(viem);
    const regNode = await register(ctx, ctx.node, BRONZE, 'react');
    const regGw = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);
    await regGw.write.slash([ctx.node.account.address, parseEther('60'), 'drop']); // -> 40, suspended
    assert.equal((await ctx.registry.read.getNode([ctx.node.account.address])).isActive, false);

    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, parseEther('100')]);
    await regNode.write.addStake([parseEther('100')]); // -> 140, back above bronze

    const info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.isActive, true);
    assert.equal(info.suspendedAt, 0n);
    assert.equal(await ctx.registry.read.activeNodeCount(), 1n);
  });

  it('unbonding delists immediately and returns stake after the period', async () => {
    const ctx = await deploy(viem);
    const regNode = await register(ctx, ctx.node, GOLD, 'unbond');
    const nodeBalBefore = await ctx.token.read.balanceOf([ctx.node.account.address]);

    await regNode.write.initiateUnbonding();
    let info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.isActive, false);
    assert.equal(info.isUnbonding, true);
    assert.equal(await ctx.registry.read.activeNodeCount(), 0n);

    // too early
    await viem.assertions.revertWithCustomError(
      regNode.write.completeUnbonding(),
      ctx.registry,
      'UnbondingNotComplete',
    );

    await networkHelpers.time.increase(7 * 24 * 60 * 60 + 1);
    await regNode.write.completeUnbonding();

    info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.exists, false); // node deleted
    assert.equal(await ctx.token.read.balanceOf([ctx.node.account.address]), nodeBalBefore + GOLD);
    assert.equal(await ctx.registry.read.totalStaked(), 0n);
  });

  it('getEligibleNodes filters by the reputation floor', async () => {
    const ctx = await deploy(viem);
    await register(ctx, ctx.node, BRONZE, 'a'); // reputation 7000
    await register(ctx, ctx.requester, BRONZE, 'b'); // reputation 7000

    // raise the floor above 7000 -> none eligible
    const eligibleHigh = await ctx.registry.read.getEligibleNodes([8000]);
    assert.equal(eligibleHigh.length, 0);

    // bump one node's reputation, then only it qualifies
    const regGw = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);
    await regGw.write.updateReputation([ctx.node.account.address, 9000]);
    const eligible = await ctx.registry.read.getEligibleNodes([8000]);
    assert.deepEqual(
      eligible.map((a) => a.toLowerCase()),
      [ctx.node.account.address.toLowerCase()],
    );
  });
});
