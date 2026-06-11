import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import { network } from 'hardhat';
import { as, deploy, jobId, signCap, creditDomain, JOB, TEST_PRIVATE_KEYS } from './helpers.js';

const REQUESTER_PK = TEST_PRIVATE_KEYS[3];

/**
 * Pins the exact pause surface of the five Pausable contracts. The runbook
 * (docs/RUNBOOK_KEYS.md) table of "what pause does / does not stop" must match
 * these tests — if a gate changes, change both. QUAISToken is NOT pausable.
 */
/** The contracts have unrelated generated types; this is their shared pause surface
 *  (calling .write.pause on the union directly is not typeable). */
type PausableSurface = {
  write: { pause: () => Promise<`0x${string}`>; unpause: () => Promise<`0x${string}`> };
};

describe('Pausable — emergency pause surface', async () => {
  const { viem, networkHelpers } = await network.create();

  // ─── Access control ──────────────────────────────────────────────────────────

  it('pause/unpause require PAUSER_ROLE on all five contracts', async () => {
    const ctx = await deploy(viem);
    for (const [name, contract] of [
      ['NodeRegistry', ctx.registry],
      ['JobEscrow', ctx.escrow],
      ['CreditAccount', ctx.credit],
      ['DisputeResolution', ctx.dispute],
      ['ProtocolTreasury', ctx.treasuryContract],
    ] as const) {
      const asOutsider = (await as(
        viem,
        name,
        contract.address,
        ctx.outsider,
      )) as unknown as PausableSurface;
      const asPauser = contract as unknown as PausableSurface;
      await viem.assertions.revertWithCustomError(
        asOutsider.write.pause(),
        contract,
        'AccessControlUnauthorizedAccount',
      );
      await asPauser.write.pause(); // deployer holds PAUSER_ROLE
      await viem.assertions.revertWithCustomError(
        asOutsider.write.unpause(),
        contract,
        'AccessControlUnauthorizedAccount',
      );
      await asPauser.write.unpause();
      assert.equal(await contract.read.paused(), false);
    }
  });

  // ─── NodeRegistry ─────────────────────────────────────────────────────────────

  it('NodeRegistry: pause gates registerNode/addStake/initiateUnbonding; unpause restores', async () => {
    const ctx = await deploy(viem);
    const stake = parseEther('100');
    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, stake * 2n]);
    const regNode = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);
    await regNode.write.registerNode([jobId('p-node'), stake]);

    await ctx.registry.write.pause();
    const regReq = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.requester);
    await viem.assertions.revertWithCustomError(
      regReq.write.registerNode([jobId('p-node-2'), stake]),
      ctx.registry,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      regNode.write.addStake([parseEther('10')]),
      ctx.registry,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      regNode.write.initiateUnbonding(),
      ctx.registry,
      'EnforcedPause',
    );

    await ctx.registry.write.unpause();
    await regNode.write.addStake([parseEther('10')]); // works again
  });

  it('NodeRegistry: completeUnbonding (stake exit) stays open while paused', async () => {
    const ctx = await deploy(viem);
    const stake = parseEther('100');
    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, stake]);
    const regNode = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);
    await regNode.write.registerNode([jobId('p-exit'), stake]);
    await regNode.write.initiateUnbonding();

    await ctx.registry.write.pause();
    const period = await ctx.registry.read.UNBONDING_PERIOD();
    await networkHelpers.time.increase(Number(period) + 1);

    const before = await ctx.token.read.balanceOf([ctx.node.account.address]);
    await regNode.write.completeUnbonding(); // must NOT revert while paused
    const after = await ctx.token.read.balanceOf([ctx.node.account.address]);
    assert.equal(after - before, stake);
  });

  // ─── JobEscrow ────────────────────────────────────────────────────────────────

  async function stagedEscrow() {
    const ctx = await deploy(viem);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.escrow.address, JOB.locked * 10n]);
    const escGw = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.gateway);
    const now = await networkHelpers.time.latest();
    const deadline = BigInt(now) + 3600n;
    const create = (id: `0x${string}`) =>
      escGw.write.createJob([
        id,
        ctx.requester.account.address,
        JOB.maxPricePerToken,
        JOB.maxTokens,
        deadline,
      ]);
    // Stage one job in each pre-terminal state.
    const pending = jobId('p-pending');
    const assigned = jobId('p-assigned');
    const completed = jobId('p-completed');
    await create(pending);
    await create(assigned);
    await escGw.write.assignJob([assigned, ctx.node.account.address, JOB.agreedPricePerToken]);
    await create(completed);
    await escGw.write.assignJob([completed, ctx.node.account.address, JOB.agreedPricePerToken]);
    await escGw.write.completeJob([completed, JOB.actualTokens, jobId('r')]);
    return { ...ctx, escGw, deadline, pending, assigned, completed };
  }

  it('JobEscrow: pause gates createJob/assignJob/completeJob/verifyAndRelease; unpause restores', async () => {
    const ctx = await stagedEscrow();
    await ctx.escrow.write.pause();

    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.createJob([
        jobId('p-new'),
        ctx.requester.account.address,
        JOB.maxPricePerToken,
        JOB.maxTokens,
        ctx.deadline,
      ]),
      ctx.escrow,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.assignJob([ctx.pending, ctx.node.account.address, JOB.agreedPricePerToken]),
      ctx.escrow,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.completeJob([ctx.assigned, JOB.actualTokens, jobId('r2')]),
      ctx.escrow,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.verifyAndRelease([ctx.completed]),
      ctx.escrow,
      'EnforcedPause',
    );

    await ctx.escrow.write.unpause();
    await ctx.escGw.write.verifyAndRelease([ctx.completed]); // settles normally again
  });

  it('JobEscrow: refund paths (failJob/cancelJob/timeoutJob) stay open while paused', async () => {
    const ctx = await stagedEscrow();
    // A short-deadline assigned job for the timeout path.
    const timedOut = jobId('p-timeout');
    const now = await networkHelpers.time.latest();
    await ctx.escGw.write.createJob([
      timedOut,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      BigInt(now) + 60n,
    ]);
    await ctx.escGw.write.assignJob([timedOut, ctx.node.account.address, JOB.agreedPricePerToken]);
    await networkHelpers.time.increase(120);

    await ctx.escrow.write.pause();

    const before = await ctx.token.read.balanceOf([ctx.requester.account.address]);
    await ctx.escGw.write.failJob([ctx.assigned, 'verification failed']);
    const escReq = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.requester);
    await escReq.write.cancelJob([ctx.pending]);
    const escOut = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.outsider);
    await escOut.write.timeoutJob([timedOut]); // anyone can time out
    const after = await ctx.token.read.balanceOf([ctx.requester.account.address]);
    assert.equal(after - before, JOB.locked * 3n); // all three fully refunded while paused
  });

  // ─── CreditAccount ────────────────────────────────────────────────────────────

  it('CreditAccount: pause gates deposit/batchSettle; unpause restores', async () => {
    const ctx = await deploy(viem);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, parseEther('100')]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([parseEther('10')]);

    await ctx.credit.write.pause();
    await viem.assertions.revertWithCustomError(
      creditReq.write.deposit([parseEther('1')]),
      ctx.credit,
      'EnforcedPause',
    );

    const chainId = await ctx.publicClient.getChainId();
    const now = await networkHelpers.time.latest();
    const cap = {
      requester: ctx.requester.account.address,
      settler: ctx.gateway.account.address,
      maxSpendWei: parseEther('5'),
      nonce: 1n,
      deadline: BigInt(now) + 3600n,
    };
    const sig = await signCap(REQUESTER_PK, cap, creditDomain(chainId, ctx.credit.address));
    const creditGw = await as(viem, 'CreditAccount', ctx.credit.address, ctx.gateway);
    const debits = [
      { jobId: jobId('p-debit'), provider: ctx.node.account.address, amountWei: parseEther('1') },
    ];
    await viem.assertions.revertWithCustomError(
      creditGw.write.batchSettle([cap, sig, debits]),
      ctx.credit,
      'EnforcedPause',
    );

    await ctx.credit.write.unpause();
    await creditGw.write.batchSettle([cap, sig, debits]); // settles normally again
  });

  // ─── DisputeResolution (Slice 5B) ─────────────────────────────────────────────

  it('DisputeResolution: pause gates raiseDispute/autoResolve; defense + reclaim stay open', async () => {
    const ctx = await deploy(viem);
    // Register the node and arm the gateway with bond money + approval.
    const tokenNode = await as(viem, 'QUAISToken', ctx.token.address, ctx.node);
    await tokenNode.write.approve([ctx.registry.address, parseEther('100')]);
    const regNode = await as(viem, 'NodeRegistry', ctx.registry.address, ctx.node);
    await regNode.write.registerNode([jobId('p-defendant'), parseEther('100')]);
    await ctx.token.write.transfer([ctx.gateway.account.address, parseEther('200')]);
    const tokenGw = await as(viem, 'QUAISToken', ctx.token.address, ctx.gateway);
    await tokenGw.write.approve([ctx.dispute.address, parseEther('200')]);
    const dispGw = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.gateway);

    const open = jobId('p-open');
    await dispGw.write.raiseDispute([open, ctx.node.account.address, jobId('evidence')]);

    await ctx.dispute.write.pause();
    // Value inflow + settlement freeze…
    await viem.assertions.revertWithCustomError(
      dispGw.write.raiseDispute([jobId('p-blocked'), ctx.node.account.address, jobId('e2')]),
      ctx.dispute,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      dispGw.write.autoResolve([open, true]),
      ctx.dispute,
      'EnforcedPause',
    );
    // …but the defendant's defense and the challenger's escape stay open.
    const dispNode = await as(viem, 'DisputeResolution', ctx.dispute.address, ctx.node);
    await dispNode.write.submitCounterEvidence([open, jobId('counter')]); // not pausable
    await networkHelpers.time.increase(30 * 24 * 60 * 60 + 1);
    const before = await ctx.token.read.balanceOf([ctx.gateway.account.address]);
    await dispGw.write.reclaimBond([open]); // bond exits under pause
    const after = await ctx.token.read.balanceOf([ctx.gateway.account.address]);
    assert.equal(after - before, parseEther('50'));

    await ctx.dispute.write.unpause();
    await dispGw.write.raiseDispute([jobId('p-after'), ctx.node.account.address, jobId('e3')]);
  });

  it('ProtocolTreasury: pause blocks distribute + allocate (protocol funds only — no user exit to keep open)', async () => {
    const ctx = await deploy(viem);
    await ctx.token.write.transfer([ctx.treasuryAddr, parseEther('100')]);
    const keeper = await as(viem, 'ProtocolTreasury', ctx.treasuryAddr, ctx.gateway);

    await ctx.treasuryContract.write.pause();
    await viem.assertions.revertWithCustomError(
      keeper.write.distribute(),
      ctx.treasuryContract,
      'EnforcedPause',
    );
    await viem.assertions.revertWithCustomError(
      ctx.treasuryContract.write.allocate([ctx.outsider.account.address, 1n, 'paused']),
      ctx.treasuryContract,
      'EnforcedPause',
    );

    await ctx.treasuryContract.write.unpause();
    await keeper.write.distribute(); // sweeps normally again
  });

  it('CreditAccount: withdrawal exit stays open while paused', async () => {
    const ctx = await deploy(viem);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, parseEther('10')]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([parseEther('10')]);

    await ctx.credit.write.pause();
    await creditReq.write.initiateWithdrawal(); // must NOT revert while paused
    const notice = await ctx.credit.read.WITHDRAWAL_NOTICE();
    await networkHelpers.time.increase(Number(notice) + 1);

    const before = await ctx.token.read.balanceOf([ctx.requester.account.address]);
    await creditReq.write.completeWithdrawal(); // principal exit works under pause
    const after = await ctx.token.read.balanceOf([ctx.requester.account.address]);
    assert.equal(after - before, parseEther('10'));
  });
});
