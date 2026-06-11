import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { as, deploy, jobId, JobStatus, JOB } from './helpers.js';

describe('JobEscrow — lifecycle & settlement', async () => {
  const { viem, networkHelpers } = await network.create();

  async function setup() {
    const ctx = await deploy(viem);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.escrow.address, JOB.locked]);
    const escGw = await as(viem, 'JobEscrow', ctx.escrow.address, ctx.gateway);
    const now = await networkHelpers.time.latest();
    const deadline = BigInt(now) + 3600n;
    return { ...ctx, escGw, deadline };
  }

  it('createJob locks exactly maxPrice*maxTokens from the requester', async () => {
    const ctx = await setup();
    const id = jobId('lock');
    const reqBefore = await ctx.token.read.balanceOf([ctx.requester.account.address]);

    await ctx.escGw.write.createJob([
      id,
      ctx.requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);

    const job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.PENDING);
    assert.equal(job.lockedAmount, JOB.locked);
    assert.equal(job.requester.toLowerCase(), ctx.requester.account.address.toLowerCase());
    assert.equal(await ctx.token.read.balanceOf([ctx.escrow.address]), JOB.locked);
    assert.equal(
      await ctx.token.read.balanceOf([ctx.requester.account.address]),
      reqBefore - JOB.locked,
    );
  });

  it('runs the full happy path and settles 95% / 5% / refund atomically', async () => {
    const ctx = await setup();
    const id = jobId('happy');
    const provider = ctx.node.account.address;
    const treasury = ctx.treasuryAddr;
    const requester = ctx.requester.account.address;

    await ctx.escGw.write.createJob([
      id,
      requester,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    await ctx.escGw.write.assignJob([id, provider, JOB.agreedPricePerToken]);

    let job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.ASSIGNED);
    assert.equal(job.provider.toLowerCase(), provider.toLowerCase());
    assert.equal(job.agreedPricePerToken, JOB.agreedPricePerToken);

    const resultHash = jobId('result-bytes');
    await ctx.escGw.write.completeJob([id, JOB.actualTokens, resultHash]);
    job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.COMPLETED);
    assert.equal(job.actualTokens, JOB.actualTokens);
    assert.equal(job.resultHash, resultHash);

    const provBefore = await ctx.token.read.balanceOf([provider]);
    const treasBefore = await ctx.token.read.balanceOf([treasury]);
    const reqBefore = await ctx.token.read.balanceOf([requester]);

    const hash = await ctx.escGw.write.verifyAndRelease([id]);
    await viem.assertions.emitWithArgs(hash, ctx.escrow, 'JobVerified', [
      id,
      JOB.providerPay,
      JOB.fee,
      JOB.refund,
    ]);

    job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.VERIFIED);

    // Balance deltas
    assert.equal(await ctx.token.read.balanceOf([provider]), provBefore + JOB.providerPay);
    assert.equal(await ctx.token.read.balanceOf([treasury]), treasBefore + JOB.fee);
    assert.equal(await ctx.token.read.balanceOf([requester]), reqBefore + JOB.refund);
    // Escrow fully drained for this (only) job
    assert.equal(await ctx.token.read.balanceOf([ctx.escrow.address]), 0n);

    // Conservation invariants
    assert.equal(JOB.providerPay + JOB.fee, JOB.actualPayment);
    assert.equal(JOB.actualPayment + JOB.refund, JOB.locked);
  });

  it('failJob refunds the requester in full and pays the provider nothing', async () => {
    const ctx = await setup();
    const id = jobId('fail');
    const provider = ctx.node.account.address;
    const requester = ctx.requester.account.address;

    await ctx.escGw.write.createJob([
      id,
      requester,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    await ctx.escGw.write.assignJob([id, provider, JOB.agreedPricePerToken]);
    await ctx.escGw.write.completeJob([id, JOB.actualTokens, jobId('bad')]);

    const provBefore = await ctx.token.read.balanceOf([provider]);
    const reqBefore = await ctx.token.read.balanceOf([requester]);

    await ctx.escGw.write.failJob([id, 'layer-b-failed']);

    const job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.FAILED);
    assert.equal(await ctx.token.read.balanceOf([provider]), provBefore); // unchanged
    assert.equal(await ctx.token.read.balanceOf([requester]), reqBefore + JOB.locked); // full refund
    assert.equal(await ctx.token.read.balanceOf([ctx.escrow.address]), 0n);
  });

  it('cancelJob refunds a never-assigned job', async () => {
    const ctx = await setup();
    const id = jobId('cancel');
    const requester = ctx.requester.account.address;
    await ctx.escGw.write.createJob([
      id,
      requester,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);

    const reqBefore = await ctx.token.read.balanceOf([requester]);
    await ctx.escGw.write.cancelJob([id]); // matching-engine may cancel
    const job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.CANCELLED);
    assert.equal(await ctx.token.read.balanceOf([requester]), reqBefore + JOB.locked);
  });

  it('timeoutJob refunds the requester only after the deadline', async () => {
    const ctx = await setup();
    const id = jobId('timeout');
    const requester = ctx.requester.account.address;
    await ctx.escGw.write.createJob([
      id,
      requester,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      ctx.deadline,
    ]);
    await ctx.escGw.write.assignJob([id, ctx.node.account.address, JOB.agreedPricePerToken]);

    // Before deadline: reverts
    await viem.assertions.revertWithCustomError(
      ctx.escGw.write.timeoutJob([id]),
      ctx.escrow,
      'DeadlineNotReached',
    );

    await networkHelpers.time.increase(3601);
    const reqBefore = await ctx.token.read.balanceOf([requester]);
    await ctx.escGw.write.timeoutJob([id]); // permissionless
    const job = await ctx.escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.FAILED);
    assert.equal(await ctx.token.read.balanceOf([requester]), reqBefore + JOB.locked);
  });
});
