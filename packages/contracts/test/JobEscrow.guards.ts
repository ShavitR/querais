import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { as, deploy, jobId, JOB } from './helpers.js';

describe('JobEscrow — access control, state machine & admin', async () => {
  const { viem, networkHelpers } = await network.create();

  async function setup() {
    const ctx = await deploy(viem);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.escrow.address, JOB.locked]);
    const escGw = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.gateway);
    const escOut = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.outsider);
    const now = await networkHelpers.time.latest();
    const deadline = BigInt(now) + 3600n;
    return { ...ctx, escGw, escOut, deadline };
  }

  // ─── Access control ──────────────────────────────────────────────────────────

  it('createJob/assignJob require MATCHING_ENGINE_ROLE', async () => {
    const ctx = await setup();
    const id = jobId('ac1');
    await viem.assertions.revertWithCustomError(
      ctx.escOut.write.createJob([
        id,
        ctx.requester.account.address,
        JOB.maxPricePerToken,
        JOB.maxTokens,
        ctx.deadline,
      ]),
      ctx.escrow,
      'AccessControlUnauthorizedAccount',
    );
    // create via gateway, then attempt assign as outsider
    await ctx.escGw.write.createJob([
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    await viem.assertions.revertWithCustomError(
      ctx.escOut.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]),
      ctx.escrow,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('completeJob/verifyAndRelease require ORACLE_ROLE', async () => {
    const ctx = await setup();
    const id = jobId('ac2');
    await ctx.escGw.write.createJob([
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    await ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]);
    await viem.assertions.revertWithCustomError(
      ctx.escOut.write.completeJob([id, JOB.actualTokens, jobId('r')]),
      ctx.escrow,
      'AccessControlUnauthorizedAccount',
    );
    await ctx.escGw.write.completeJob([id, JOB.actualTokens, jobId('r')]);
    await viem.assertions.revertWithCustomError(
      ctx.escOut.write.verifyAndRelease([id]),
      ctx.escrow,
      'AccessControlUnauthorizedAccount',
    );
  });

  // ─── State machine ────────────────────────────────────────────────────────────

  it('rejects out-of-order transitions', async () => {
    const ctx = await setup();
    const id = jobId('sm');

    // assign before create
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]),
      ctx.escrow,
      'UnexpectedStatus',
    );

    await ctx.escGw.write.createJob([
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);

    // complete before assign
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.completeJob([id, JOB.actualTokens, jobId('r')]),
      ctx.escrow,
      'UnexpectedStatus',
    );

    // verify before complete
    await ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]);
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.verifyAndRelease([id]),
      ctx.escrow,
      'UnexpectedStatus',
    );
  });

  it('rejects duplicate job ids and double release', async () => {
    const ctx = await setup();
    const id = jobId('dup');
    const args = [
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ] as const;
    await ctx.escGw.write.createJob([...args]);
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.createJob([...args]),
      ctx.escrow,
      'JobAlreadyExists',
    );

    await ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]);
    await ctx.escGw.write.completeJob([id, JOB.actualTokens, jobId('r')]);
    await ctx.escGw.write.verifyAndRelease([id]);
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.verifyAndRelease([id]),
      ctx.escrow,
      'UnexpectedStatus',
    );
  });

  it('enforces price and token bounds', async () => {
    const ctx = await setup();
    const id = jobId('bounds');
    await ctx.escGw.write.createJob([
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    // agreed price above max
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.maxPricePerToken + 1n]),
      ctx.escrow,
      'PriceAboveMax',
    );
    await ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]);
    // actual tokens above max
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.completeJob([id, JOB.maxTokens + 1n, jobId('r')]),
      ctx.escrow,
      'TokensAboveMax',
    );
  });

  it('rejects zero amounts and past deadlines on createJob', async () => {
    const ctx = await setup();
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.createJob([
        jobId('z1'),
        ctx.requester.account.address,
        0n,
        JOB.maxTokens,
        ctx.deadline,
      ]),
      ctx.escrow,
      'ZeroAmount',
    );
    const now = await networkHelpers.time.latest();
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.createJob([
        jobId('z2'),
        ctx.requester.account.address,
        JOB.maxPricePerToken,
        JOB.maxTokens,
        BigInt(now), // not strictly in the future
      ]),
      ctx.escrow,
      'DeadlineInPast',
    );
  });

  // ─── Admin & pausing ──────────────────────────────────────────────────────────

  it('only admin can set fee rate, and the rate is capped', async () => {
    const ctx = await setup();
    await viem.assertions.revertWithCustomError(
      ctx.escOut.write.setProtocolFeeRate([400]),
      ctx.escrow,
      'AccessControlUnauthorizedAccount',
    );
    await viem.assertions.revertWithCustomError(
      ctx.escrow.write.setProtocolFeeRate([1001]), // default signer is admin
      ctx.escrow,
      'FeeRateTooHigh',
    );
    await ctx.escrow.write.setProtocolFeeRate([400]);
  });

  it('setTreasury rejects the zero address', async () => {
    const ctx = await setup();
    await viem.assertions.revertWithCustomError(
      ctx.escrow.write.setTreasury(['0x0000000000000000000000000000000000000000']),
      ctx.escrow,
      'ZeroAddress',
    );
  });

  it('pausing blocks job creation', async () => {
    const ctx = await setup();
    await ctx.escrow.write.pause();
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.createJob([
        jobId('paused'),
        ctx.requester.account.address,
        JOB.maxPricePerToken,
        JOB.maxTokens,
        ctx.deadline,
      ]),
      ctx.escrow,
      'EnforcedPause',
    );
  });
});
