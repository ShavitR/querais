import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { keccak256, parseEther, toHex, zeroAddress } from 'viem';
import { as, deploy, jobId } from './helpers.js';

const BOND = parseEther('50');
const STAKE = parseEther('2500'); // Gold-tier defendant
const EVIDENCE = keccak256(toHex('layer-a similarity 0.31 < 0.70'));
const COUNTER = keccak256(toHex('execution logs + output hash'));

describe('DisputeResolution', async () => {
  const { viem, networkHelpers } = await network.create();

  /** Register the ctx.node as a staked defendant and approve the gateway's bond. */
  async function setup(stake = STAKE) {
    const ctx = await deploy(viem);
    const nodeToken = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await nodeToken.write.approve([ctx.registry.address, stake]);
    const nodeRegistry = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);
    await nodeRegistry.write.registerNode([jobId('defendant'), stake]);

    // The gateway (oracle/challenger) needs QAIS for bonds + approval.
    await ctx.token.write.transfer([ctx.gateway.account.address, parseEther('500')]);
    const gwToken = await as(viem, 'QUAISToken', ctx.token.address, ctx.gateway);
    await gwToken.write.approve([ctx.dispute.address, parseEther('500')]);
    const gwDispute = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.gateway);
    return { ...ctx, gwDispute };
  }

  const bal = (ctx: Awaited<ReturnType<typeof deploy>>, addr: `0x${string}`) =>
    ctx.token.read.balanceOf([addr]);

  it('raiseDispute pulls the bond and records the challenge; duplicates revert', async () => {
    const ctx = await setup();
    const id = jobId('disputed-job');
    const gw0 = await bal(ctx, ctx.gateway.account.address);

    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);

    assert.equal(gw0 - (await bal(ctx, ctx.gateway.account.address)), BOND, 'bond pulled');
    const d = await ctx.dispute.read.disputes([id]);
    // disputes() returns the struct as a tuple: [challenger, defendant, bond, evidence,
    // counterEvidence, raisedAt, status, challengerWon]
    assert.equal(d[0].toLowerCase(), ctx.gateway.account.address.toLowerCase());
    assert.equal(d[1].toLowerCase(), ctx.node.account.address.toLowerCase());
    assert.equal(d[2], BOND);
    assert.equal(d[6], 1, 'status OPEN');

    await assert.rejects(
      ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]),
      /DisputeExists/,
    );
  });

  it('raiseDispute rejects unregistered defendants and empty evidence', async () => {
    const ctx = await setup();
    await assert.rejects(
      ctx.gwDispute.write.raiseDispute([jobId('x'), ctx.outsider.account.address, EVIDENCE]),
      /NotANode/,
    );
    await assert.rejects(
      ctx.gwDispute.write.raiseDispute([
        jobId('y'),
        ctx.node.account.address,
        `0x${'00'.repeat(32)}`,
      ]),
      /ZeroEvidence/,
    );
  });

  it('counter-evidence: defendant-only, within 24h, once', async () => {
    const ctx = await setup();
    const id = jobId('countered-job');
    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);

    const asOutsider = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.outsider);
    await assert.rejects(asOutsider.write.submitCounterEvidence([id, COUNTER]), /NotDefendant/);

    const asNode = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.node);
    await asNode.write.submitCounterEvidence([id, COUNTER]);
    const d = await ctx.dispute.read.disputes([id]);
    assert.equal(d[4], COUNTER, 'counter-evidence committed');
    assert.equal(d[6], 2, 'status COUNTERED');
    await assert.rejects(asNode.write.submitCounterEvidence([id, COUNTER]), /AlreadyCountered/);

    // A second dispute whose window has lapsed refuses late counter-evidence.
    const late = jobId('late-counter');
    await ctx.gwDispute.write.raiseDispute([late, ctx.node.account.address, EVIDENCE]);
    await networkHelpers.time.increase(24 * 60 * 60 + 1);
    await assert.rejects(
      asNode.write.submitCounterEvidence([late, COUNTER]),
      /CounterWindowClosed/,
    );
  });

  it('autoResolve (challenger wins): 20% slash split 50/30/20 burn/challenger/treasury + bond back', async () => {
    const ctx = await setup();
    const id = jobId('cheater-job');
    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);

    const slash = (STAKE * 2000n) / 10000n; // 500 QAIS
    const burn = (slash * 5000n) / 10000n; // 250
    const challengerCut = (slash * 3000n) / 10000n; // 150
    const treasuryCut = slash - burn - challengerCut; // 100

    const [gw0, t0, supply0] = await Promise.all([
      bal(ctx, ctx.gateway.account.address),
      bal(ctx, ctx.treasury.account.address),
      ctx.token.read.totalSupply(),
    ]);

    await ctx.gwDispute.write.autoResolve([id, true]);

    const info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.stakeAmount, STAKE - slash, 'defendant slashed 20%');
    assert.equal(
      (await bal(ctx, ctx.gateway.account.address)) - gw0,
      BOND + challengerCut,
      'challenger: bond returned + 30% of the slash',
    );
    assert.equal(
      (await bal(ctx, ctx.treasury.account.address)) - t0,
      treasuryCut,
      'treasury receives 20%',
    );
    assert.equal(supply0 - (await ctx.token.read.totalSupply()), burn, '50% burned');
    // Conservation: every slashed wei is burned, paid, or banked.
    assert.equal(burn + challengerCut + treasuryCut, slash);
    // Nothing strands in the dispute contract.
    assert.equal(await bal(ctx, ctx.dispute.address), 0n);

    await assert.rejects(ctx.gwDispute.write.autoResolve([id, true]), /AlreadyResolved/);
  });

  it('autoResolve (provider wins): the bond burns, the defendant is untouched', async () => {
    const ctx = await setup();
    const id = jobId('frivolous');
    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);

    const supply0 = await ctx.token.read.totalSupply();
    await ctx.gwDispute.write.autoResolve([id, false]);

    assert.equal(supply0 - (await ctx.token.read.totalSupply()), BOND, 'bond burned');
    const info = await ctx.registry.read.getNode([ctx.node.account.address]);
    assert.equal(info.stakeAmount, STAKE, 'no slash on a failed challenge');
  });

  it('autoResolve is oracle-only; resolving a missing dispute reverts', async () => {
    const ctx = await setup();
    const id = jobId('gated');
    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);
    const asOutsider = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.outsider);
    await assert.rejects(asOutsider.write.autoResolve([id, true]), /AccessControl/);
    await assert.rejects(ctx.gwDispute.write.autoResolve([jobId('ghost'), true]), /NoSuchDispute/);
  });

  it('reclaimBond: challenger-only escape hatch after 30 days unresolved', async () => {
    const ctx = await setup();
    const id = jobId('stale');
    await ctx.gwDispute.write.raiseDispute([id, ctx.node.account.address, EVIDENCE]);

    await assert.rejects(ctx.gwDispute.write.reclaimBond([id]), /ReclaimNotReady/);
    await networkHelpers.time.increase(30 * 24 * 60 * 60 + 1);

    const asOutsider = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.outsider);
    await assert.rejects(asOutsider.write.reclaimBond([id]), /NotChallenger/);

    const gw0 = await bal(ctx, ctx.gateway.account.address);
    await ctx.gwDispute.write.reclaimBond([id]);
    assert.equal((await bal(ctx, ctx.gateway.account.address)) - gw0, BOND, 'bond recovered');
    await assert.rejects(ctx.gwDispute.write.reclaimBond([id]), /AlreadyResolved/);
  });

  it('registry.slashTo routes proceeds to the recipient (SLASHER-gated)', async () => {
    const ctx = await setup();
    const amount = parseEther('100');
    const gwRegistry = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.gateway);

    const r0 = await bal(ctx, ctx.outsider.account.address);
    await gwRegistry.write.slashTo([
      ctx.node.account.address,
      amount,
      ctx.outsider.account.address,
      'routed slash',
    ]);
    assert.equal((await bal(ctx, ctx.outsider.account.address)) - r0, amount, 'proceeds routed');

    await assert.rejects(
      gwRegistry.write.slashTo([ctx.node.account.address, amount, zeroAddress, 'bad recipient']),
      /ZeroAddress/,
    );
    const asOutsider = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.outsider);
    await assert.rejects(
      asOutsider.write.slashTo([
        ctx.node.account.address,
        amount,
        ctx.outsider.account.address,
        'unauthorized',
      ]),
      /AccessControl/,
    );
  });
});
