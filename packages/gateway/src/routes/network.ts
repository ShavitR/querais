import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

/** Fixed $QAIS supply at launch — 1,000,000,000 (CLAUDE.md / token economics, no mint). */
const INITIAL_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

/**
 * Slice 10D — public, unauthenticated network surface for the live explorer.
 *  - GET /v1/network/recent-jobs — a ticker of recent jobs (hashes + models only; privacy).
 *  - GET /v1/network/economics   — supply / burned / treasury / staker pool (graceful zeros
 *                                  on chains that predate the 6A treasury).
 */
export function registerNetwork(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/network/recent-jobs', async (request) => {
    const { limit } = request.query as { limit?: string };
    return { object: 'list', data: deps.jobs.recent(limit ? Number(limit) : 20) };
  });

  app.get('/v1/network/economics', async () => {
    const treasuryAddr = deps.chain.treasuryContract() ?? deps.chain.deployment.treasury;
    const staking = deps.chain.stakingRewardsContract();
    const [totalSupplyWei, treasuryBalanceWei, stakerPoolWei] = await Promise.all([
      deps.chain.totalSupply(),
      deps.chain.tokenBalance(treasuryAddr),
      staking ? deps.chain.tokenBalance(staking) : Promise.resolve(0n),
    ]);
    const burnedWei =
      totalSupplyWei < INITIAL_SUPPLY_WEI ? INITIAL_SUPPLY_WEI - totalSupplyWei : 0n;
    return {
      totalSupplyWei: totalSupplyWei.toString(),
      burnedWei: burnedWei.toString(),
      treasuryBalanceWei: treasuryBalanceWei.toString(),
      stakerPoolWei: stakerPoolWei.toString(),
    };
  });
}
