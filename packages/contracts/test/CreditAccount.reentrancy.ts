import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { encodeFunctionData, parseEther } from 'viem';
import { as, creditDomain, jobId, signCap, TEST_PRIVATE_KEYS } from './helpers.js';

describe('CreditAccount — reentrancy', async () => {
  const { viem, networkHelpers } = await network.create();
  const REQUESTER_PK = TEST_PRIVATE_KEYS[3];

  it('batchSettle cannot be re-entered via a malicious token (no double-spend)', async () => {
    const wallets = await viem.getWalletClients();
    const [deployer, gateway, node, requester, treasury] = wallets;
    if (!deployer || !gateway || !node || !requester || !treasury) throw new Error('accounts');
    const publicClient = await viem.getPublicClient();
    // These suites use a malicious mock token (not QAIS), so a plain EOA fee
    // recipient is correct here — the real ProtocolTreasury is out of scope.
    const treasuryAddr = treasury.account.address;

    // Credit account backed by a malicious ERC-20 that re-enters on transfer.
    const token = await viem.deployContract('ReentrantBatchToken', []);
    const credit = await viem.deployContract('CreditAccount', [
      token.address,
      treasuryAddr,
      deployer.account.address,
    ]);

    // Grant SETTLER_ROLE to both the gateway and the token, so the re-entrant call passes
    // access control and is stopped specifically by the ReentrancyGuard.
    const SETTLER = await credit.read.SETTLER_ROLE();
    await credit.write.grantRole([SETTLER, gateway.account.address]);
    await credit.write.grantRole([SETTLER, token.address]);

    // Fund + deposit for the requester.
    await token.write.mintTo([requester.account.address, parseEther('100')]);
    const tokenReq = await as(viem, 'QUAISToken', token.address, requester);
    await tokenReq.write.approve([credit.address, parseEther('100')]);
    const creditReq = await as(viem, 'CreditAccount', credit.address, requester);
    await creditReq.write.deposit([parseEther('100')]);

    const chainId = await publicClient.getChainId();
    const domain = creditDomain(chainId, credit.address);
    const now = await networkHelpers.time.latest();
    const deadline = BigInt(now) + 3600n;

    // Re-entry payload: a second batchSettle whose settler is the token itself.
    const reentryCap = {
      requester: requester.account.address,
      settler: token.address,
      maxSpendWei: parseEther('100'),
      nonce: 2n,
      deadline,
    };
    const reentrySig = await signCap(REQUESTER_PK, reentryCap, domain);
    const reentryData = encodeFunctionData({
      abi: credit.abi,
      functionName: 'batchSettle',
      args: [
        reentryCap,
        reentrySig,
        [{ jobId: jobId('re-inner'), provider: node.account.address, amountWei: parseEther('1') }],
      ],
    });
    await token.write.arm([credit.address, reentryData]);

    // Outer settlement; paying the provider triggers the armed re-entry, which must revert.
    const outerCap = {
      requester: requester.account.address,
      settler: gateway.account.address,
      maxSpendWei: parseEther('100'),
      nonce: 1n,
      deadline,
    };
    const outerSig = await signCap(REQUESTER_PK, outerCap, domain);
    const creditGw = await as(viem, 'CreditAccount', credit.address, gateway);

    await assert.rejects(
      creditGw.write.batchSettle([
        outerCap,
        outerSig,
        [{ jobId: jobId('re-outer'), provider: node.account.address, amountWei: parseEther('1') }],
      ]),
    );

    // Invariant: nothing moved — deposit intact, no payout, neither job recorded as settled.
    assert.equal(await credit.read.balanceOf([requester.account.address]), parseEther('100'));
    assert.equal(await token.read.balanceOf([node.account.address]), 0n);
    assert.equal(await token.read.balanceOf([treasuryAddr]), 0n);
    assert.equal(await credit.read.settledJob([jobId('re-outer')]), false);
    assert.equal(await credit.read.settledJob([jobId('re-inner')]), false);
    assert.equal(await credit.read.spentAgainst([requester.account.address, 1n]), 0n);
  });
});
