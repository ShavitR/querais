import hardhatToolboxViemPlugin from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';

/**
 * QueraIS contracts — Hardhat 3 + viem + node:test.
 *
 * - `default` / `production` profiles both pin Solidity 0.8.28 with the optimizer
 *   and a fixed evmVersion so test bytecode matches what we ship (toward-production).
 * - `localhost` is the `pnpm chain` node (started via `hardhat node`); deploy:local
 *   connects to it. Accounts are left unset so we use the node's funded dev accounts.
 * - Tests spin up their own in-process EDR network via `network.create()`.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'cancun',
        },
      },
      production: {
        version: '0.8.28',
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'cancun',
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    localhost: {
      type: 'http',
      chainType: 'l1',
      url: 'http://127.0.0.1:8545',
    },
  },
});
