import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { parseEther } from 'viem';
import { as } from './helpers.js';

describe('QUAISToken', async () => {
  const { viem } = await network.create();

  async function deployToken() {
    const [holder] = await viem.getWalletClients();
    if (!holder) throw new Error('no accounts');
    const token = await viem.deployContract('QUAISToken', [holder.account.address]);
    return { token, holder };
  }

  it('mints the full fixed supply to the initial holder', async () => {
    const { token, holder } = await deployToken();
    const supply = await token.read.totalSupply();
    assert.equal(supply, parseEther('1000000000'));
    assert.equal(await token.read.balanceOf([holder.account.address]), supply);
  });

  it('has the expected metadata', async () => {
    const { token } = await deployToken();
    assert.equal(await token.read.name(), 'QueraIS Token');
    assert.equal(await token.read.symbol(), 'QAIS');
    assert.equal(await token.read.decimals(), 18);
  });

  it('exposes no mint function (supply is fixed)', async () => {
    const { token } = await deployToken();
    assert.equal('mint' in token.write, false);
  });

  it('burn permanently reduces total supply', async () => {
    const { token, holder } = await deployToken();
    const before = await token.read.totalSupply();
    await token.write.burn([parseEther('1000')]);
    assert.equal(await token.read.totalSupply(), before - parseEther('1000'));
    assert.equal(await token.read.balanceOf([holder.account.address]), before - parseEther('1000'));
  });

  it('burnFrom requires allowance', async () => {
    const { token, holder } = await deployToken();
    const wallets = await viem.getWalletClients();
    const spender = wallets[1];
    if (!spender) throw new Error('no spender');

    const tokenAsSpender = await as(viem, 'QUAISToken', token.address, spender);
    await viem.assertions.revertWithCustomError(
      tokenAsSpender.write.burnFrom([holder.account.address, parseEther('10')]),
      token,
      'ERC20InsufficientAllowance',
    );

    await token.write.approve([spender.account.address, parseEther('10')]);
    const before = await token.read.totalSupply();
    await tokenAsSpender.write.burnFrom([holder.account.address, parseEther('10')]);
    assert.equal(await token.read.totalSupply(), before - parseEther('10'));
  });
});
