import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  as,
  capDigest,
  creditDomain,
  deploy,
  jobId,
  signCap,
  TEST_PRIVATE_KEYS,
  type CapInput,
} from './helpers.js';

describe('CreditAccount — deposit, batched settlement & withdrawal', async () => {
  const { viem, networkHelpers } = await network.create();

  const REQUESTER_PK = TEST_PRIVATE_KEYS[3];
  const DEPOSIT = parseEther('100');
  const WITHDRAWAL_NOTICE = 24n * 3600n;

  async function setup() {
    const ctx = await deploy(viem);
    // The requester wallet's key must match its dev account, so off-chain signatures verify.
    assert.equal(
      privateKeyToAccount(REQUESTER_PK).address.toLowerCase(),
      ctx.requester.account.address.toLowerCase(),
      'TEST_PRIVATE_KEYS[3] must match the requester dev account',
    );
    const chainId = await ctx.publicClient.getChainId();
    const domain = creditDomain(chainId, ctx.credit.address);

    // Requester pre-funds a credit balance.
    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, DEPOSIT]);
    const creditReq = await as(viem, 'CreditAccount', ctx.credit.address, ctx.requester);
    await creditReq.write.deposit([DEPOSIT]);

    const creditGw = await as(viem, 'CreditAccount', ctx.credit.address, ctx.gateway);
    const now = await networkHelpers.time.latest();
    return { ...ctx, domain, creditReq, creditGw, deadline: BigInt(now) + 3600n };
  }

  function makeCap(ctx: Awaited<ReturnType<typeof setup>>, over: Partial<CapInput> = {}): CapInput {
    return {
      requester: ctx.requester.account.address,
      settler: ctx.gateway.account.address,
      maxSpendWei: parseEther('100'),
      nonce: 1n,
      deadline: ctx.deadline,
      ...over,
    };
  }

  it('deposit credits the balance and moves tokens into the contract', async () => {
    const ctx = await setup();
    assert.equal(await ctx.credit.read.balanceOf([ctx.requester.account.address]), DEPOSIT);
    assert.equal(await ctx.token.read.balanceOf([ctx.credit.address]), DEPOSIT);
  });

  it('the on-chain EIP-712 digest matches the canonical off-chain hash', async () => {
    const ctx = await setup();
    const cap = makeCap(ctx);
    const onChain = await ctx.credit.read.hashSpendingCap([cap]);
    assert.equal(onChain, capDigest(cap, ctx.domain));
  });

  it('batchSettle pays each provider 95%, the treasury 5%, and debits the deposit once', async () => {
    const ctx = await setup();
    const cap = makeCap(ctx);
    const sig = await signCap(REQUESTER_PK, cap, ctx.domain);

    const provider1 = ctx.node.account.address;
    const provider2 = ctx.outsider.account.address;
    const treasury = ctx.treasury.account.address;
    const debits = [
      { jobId: jobId('b-1'), provider: provider1, amountWei: parseEther('1') },
      { jobId: jobId('b-2'), provider: provider2, amountWei: parseEther('2') },
      { jobId: jobId('b-3'), provider: provider1, amountWei: parseEther('0.5') },
    ];
    const total = parseEther('3.5');
    const fee1 = parseEther('0.05');
    const fee2 = parseEther('0.1');
    const fee3 = parseEther('0.025');
    const totalFee = fee1 + fee2 + fee3; // 0.175
    const p1Pay = parseEther('1') - fee1 + (parseEther('0.5') - fee3); // 0.95 + 0.475
    const p2Pay = parseEther('2') - fee2; // 1.9

    const p1Before = await ctx.token.read.balanceOf([provider1]);
    const p2Before = await ctx.token.read.balanceOf([provider2]);
    const treasBefore = await ctx.token.read.balanceOf([treasury]);

    const hash = await ctx.creditGw.write.batchSettle([cap, sig, debits]);
    await viem.assertions.emitWithArgs(hash, ctx.credit, 'BatchSettled', [
      ctx.requester.account.address,
      ctx.gateway.account.address,
      1n,
      3n,
      total,
      totalFee,
    ]);

    assert.equal(await ctx.token.read.balanceOf([provider1]), p1Before + p1Pay);
    assert.equal(await ctx.token.read.balanceOf([provider2]), p2Before + p2Pay);
    assert.equal(await ctx.token.read.balanceOf([treasury]), treasBefore + totalFee);
    // Deposit debited by exactly the gross total.
    assert.equal(await ctx.credit.read.balanceOf([ctx.requester.account.address]), DEPOSIT - total);
    assert.equal(await ctx.credit.read.spentAgainst([ctx.requester.account.address, 1n]), total);
    assert.equal(await ctx.credit.read.settledJob([jobId('b-2')]), true);
    // Conservation: every provider payout plus the fee equals what left the deposit.
    assert.equal(p1Pay + p2Pay + totalFee, total);
  });

  it('one signed cap funds incremental settlement across multiple batches', async () => {
    const ctx = await setup();
    const cap = makeCap(ctx, { maxSpendWei: parseEther('5'), nonce: 2n });
    const sig = await signCap(REQUESTER_PK, cap, ctx.domain);
    const provider = ctx.node.account.address;

    await ctx.creditGw.write.batchSettle([
      cap,
      sig,
      [{ jobId: jobId('i-1'), provider, amountWei: parseEther('2') }],
    ]);
    await ctx.creditGw.write.batchSettle([
      cap,
      sig,
      [{ jobId: jobId('i-2'), provider, amountWei: parseEther('3') }],
    ]);

    assert.equal(
      await ctx.credit.read.spentAgainst([ctx.requester.account.address, 2n]),
      parseEther('5'),
    );
    assert.equal(
      await ctx.credit.read.balanceOf([ctx.requester.account.address]),
      DEPOSIT - parseEther('5'),
    );
  });

  it('withdraw-after-notice returns the residual balance only after the window', async () => {
    const ctx = await setup();
    const cap = makeCap(ctx, { nonce: 3n });
    const sig = await signCap(REQUESTER_PK, cap, ctx.domain);
    await ctx.creditGw.write.batchSettle([
      cap,
      sig,
      [{ jobId: jobId('w-1'), provider: ctx.node.account.address, amountWei: parseEther('10') }],
    ]);
    const residual = DEPOSIT - parseEther('10');

    await ctx.creditReq.write.initiateWithdrawal();
    await viem.assertions.revertWithCustomError(
      ctx.creditReq.write.completeWithdrawal(),
      ctx.credit,
      'WithdrawalNotReady',
    );

    await networkHelpers.time.increase(Number(WITHDRAWAL_NOTICE) + 1);
    const reqBefore = await ctx.token.read.balanceOf([ctx.requester.account.address]);
    await ctx.creditReq.write.completeWithdrawal();
    assert.equal(
      await ctx.token.read.balanceOf([ctx.requester.account.address]),
      reqBefore + residual,
    );
    assert.equal(await ctx.credit.read.balanceOf([ctx.requester.account.address]), 0n);
  });

  it('depositing again cancels a pending withdrawal', async () => {
    const ctx = await setup();
    await ctx.creditReq.write.initiateWithdrawal();
    assert.notEqual(await ctx.credit.read.withdrawableAt([ctx.requester.account.address]), 0n);

    const tokenReq = await as(viem, 'QUAISToken', ctx.token.address, ctx.requester);
    await tokenReq.write.approve([ctx.credit.address, parseEther('1')]);
    await ctx.creditReq.write.deposit([parseEther('1')]);

    assert.equal(await ctx.credit.read.withdrawableAt([ctx.requester.account.address]), 0n);
    await viem.assertions.revertWithCustomError(
      ctx.creditReq.write.completeWithdrawal(),
      ctx.credit,
      'NoWithdrawalPending',
    );
  });
});
