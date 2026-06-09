import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import {
  as,
  creditDomain,
  deploy,
  jobId,
  signCap,
  TEST_PRIVATE_KEYS,
  type CapInput,
} from './helpers.js';

describe('CreditAccount — guards (auth, signature, cap, replay)', async () => {
  const { viem, networkHelpers } = await network.create();
  const REQUESTER_PK = TEST_PRIVATE_KEYS[3];
  const OUTSIDER_PK = TEST_PRIVATE_KEYS[5];

  async function setup(deposit = parseEther('100')) {
    const ctx = await deploy(viem);
    const chainId = await ctx.publicClient.getChainId();
    const domain = creditDomain(chainId, ctx.credit.address);
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, deposit]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([deposit]);
    const creditGw = await as(viem, 'CreditAccount', ctx.credit.address, ctx.gateway);
    const now = await networkHelpers.time.latest();
    return { ...ctx, domain, creditGw, deadline: BigInt(now) + 3600n };
  }

  function cap(ctx: Awaited<ReturnType<typeof setup>>, over: Partial<CapInput> = {}): CapInput {
    return {
      requester: ctx.requester.account.address,
      settler: ctx.gateway.account.address,
      maxSpendWei: parseEther('100'),
      nonce: 1n,
      deadline: ctx.deadline,
      ...over,
    };
  }

  function debit(label: string, ctx: Awaited<ReturnType<typeof setup>>, amount = parseEther('1')) {
    return { jobId: jobId(label), provider: ctx.node.account.address, amountWei: amount };
  }

  it('batchSettle requires SETTLER_ROLE', async () => {
    const ctx = await setup();
    const c = cap(ctx, { settler: ctx.outsider.account.address });
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    const creditOut = await as(viem, 'CreditAccount', ctx.credit.address, ctx.outsider);
    await viem.assertions.revertWithCustomError(
      creditOut.write.batchSettle([c, sig, [debit('g-role', ctx)]]),
      ctx.credit,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('rejects an empty batch', async () => {
    const ctx = await setup();
    const c = cap(ctx);
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, []]),
      ctx.credit,
      'EmptyBatch',
    );
  });

  it('rejects an expired cap', async () => {
    const ctx = await setup();
    const now = await networkHelpers.time.latest();
    const c = cap(ctx, { deadline: BigInt(now) - 1n });
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [debit('g-exp', ctx)]]),
      ctx.credit,
      'CapExpired',
    );
  });

  it('rejects a settler other than the one named in the cap', async () => {
    const ctx = await setup();
    const c = cap(ctx, { settler: ctx.outsider.account.address });
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    // gateway has the role but is not the named settler.
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [debit('g-settler', ctx)]]),
      ctx.credit,
      'WrongSettler',
    );
  });

  it('rejects a signature not from the requester', async () => {
    const ctx = await setup();
    const c = cap(ctx);
    const badSig = await signCap(OUTSIDER_PK, c, ctx.domain); // signed by the wrong key
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, badSig, [debit('g-sig', ctx)]]),
      ctx.credit,
      'BadSignature',
    );
  });

  it('rejects spending beyond the signed cap', async () => {
    const ctx = await setup();
    const c = cap(ctx, { maxSpendWei: parseEther('1') });
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [debit('g-cap', ctx, parseEther('2'))]]),
      ctx.credit,
      'CapExceeded',
    );
  });

  it('rejects settling more than the deposited balance', async () => {
    const ctx = await setup(parseEther('100'));
    const c = cap(ctx, { maxSpendWei: parseEther('200') });
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [debit('g-bal', ctx, parseEther('150'))]]),
      ctx.credit,
      'InsufficientBalance',
    );
  });

  it('rejects re-settling a job (replay) across batches', async () => {
    const ctx = await setup();
    const c = cap(ctx);
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    const d = debit('g-replay', ctx);
    await ctx.creditGw.write.batchSettle([c, sig, [d]]);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [d]]),
      ctx.credit,
      'JobAlreadySettled',
    );
  });

  it('rejects a duplicate jobId within one batch', async () => {
    const ctx = await setup();
    const c = cap(ctx);
    const sig = await signCap(REQUESTER_PK, c, ctx.domain);
    const d = debit('g-dup', ctx);
    await viem.assertions.revertWithCustomError(
      ctx.creditGw.write.batchSettle([c, sig, [d, d]]),
      ctx.credit,
      'JobAlreadySettled',
    );
  });
});
