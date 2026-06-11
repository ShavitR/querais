import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { as, jobId, JobStatus, JOB } from './helpers.js';

describe('JobEscrow — reentrancy', async () => {
  const { viem, networkHelpers } = await network.create();

  it('verifyAndRelease cannot be re-entered via a malicious token (no drain)', async () => {
    const wallets = await viem.getWalletClients();
    const [deployer, gateway, node, requester, treasury] = wallets;
    if (!deployer || !gateway || !node || !requester || !treasury) throw new Error('accounts');
    // These suites use a malicious mock token (not QAIS), so a plain EOA fee
    // recipient is correct here — the real ProtocolTreasury is out of scope.
    const treasuryAddr = treasury.account.address;

    // Deploy escrow backed by a malicious ERC-20 that re-enters on transfer.
    const token = await viem.deployContract('ReentrantToken', []);
    const escrow = await viem.deployContract('JobEscrow', [
      token.address,
      treasuryAddr,
      deployer.account.address,
    ]);

    const ESC_ORACLE = await escrow.read.ORACLE_ROLE();
    const ESC_MATCHING = await escrow.read.MATCHING_ENGINE_ROLE();
    await escrow.write.grantRole([ESC_ORACLE, gateway.account.address]);
    await escrow.write.grantRole([ESC_MATCHING, gateway.account.address]);
    // Give the token ORACLE_ROLE so its re-entrant call passes auth and is stopped
    // specifically by the ReentrancyGuard rather than by access control.
    await escrow.write.grantRole([ESC_ORACLE, token.address]);

    // Fund + approve the requester.
    await token.write.mintTo([requester.account.address, JOB.locked]);
    const tokenReq = await as(viem, 'QUAISToken', token.address, requester);
    await tokenReq.write.approve([escrow.address, JOB.locked]);

    const escGw = await as(viem, 'JobEscrow', escrow.address, gateway);
    const id = jobId('reentry');
    const now = await networkHelpers.time.latest();
    await escGw.write.createJob([
      id,
      requester.account.address,
      JOB.maxPricePerToken,
      JOB.maxTokens,
      BigInt(now) + 3600n,
    ]);
    await escGw.write.assignJob([id, node.account.address, JOB.agreedPricePerToken]);
    await escGw.write.completeJob([id, JOB.actualTokens, jobId('r')]);

    // Arm the attack: next transfer re-enters verifyAndRelease for the same job.
    await token.write.arm([escrow.address, id]);

    // Settlement must revert; the guard prevents double settlement / draining.
    await assert.rejects(escGw.write.verifyAndRelease([id]));

    // Invariant: nothing moved — job still COMPLETED, full lock still in escrow.
    const job = await escrow.read.getJob([id]);
    assert.equal(job.status, JobStatus.COMPLETED);
    assert.equal(await token.read.balanceOf([escrow.address]), JOB.locked);
    assert.equal(await token.read.balanceOf([node.account.address]), 0n);
  });
});
