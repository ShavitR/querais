import type { FastifyInstance } from 'fastify';
import { AuthError } from '@querais/shared';
import type { GatewayDeps } from '../deps.js';
import { requireWalletSession } from '../auth.js';
import { SESSION_COOKIE } from '../session.js';
import { openAiError } from '../http.js';

const DAY_MS = 86_400_000;

/**
 * Slice 10C operator console. `GET /v1/operator/overview` returns the signed-in node's OWN
 * data — there is no `:wallet` param, so the cookie wallet is the only node you can see.
 * Read-only: reputation (current + published history), earnings, latency telemetry, the
 * flags raised against you (incl. reviewed), and the Layer-A verdicts behind them. Privacy
 * holds — verdicts carry hashes/scores only, never prompt/output text.
 */
export function registerOperator(app: FastifyInstance, deps: GatewayDeps): void {
  app.get('/v1/operator/overview', async (request, reply) => {
    let wallet;
    try {
      wallet = requireWalletSession(deps.session, request.cookies[SESSION_COOKIE]);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send(openAiError(err.message, 'invalid_request'));
      }
      throw err;
    }

    const now = Date.now();
    const d = await deps.reputation.dimensionsFor(wallet);
    const node = deps.pool.listNodes().find((n) => n.wallet.toLowerCase() === wallet.toLowerCase());
    const claimableRewardsWei = (
      deps.chain.stakingRewardsContract() ? await deps.chain.claimableRewards(wallet) : 0n
    ).toString();

    return reply.send({
      wallet,
      connected: !!node,
      jobsServed: node?.jobsServed ?? null,
      models:
        node?.models.map((m) => ({
          model: m.model,
          pricePerTokenWei: m.pricePerTokenWei,
          tokensPerSecond: m.tokensPerSecond,
        })) ?? [],
      claimableRewardsWei,
      reputation: {
        composite: d.compositeBps / 10000,
        accuracy: d.accuracyBps / 10000,
        uptime: d.uptimeBps / 10000,
        latency: d.latencyBps / 10000,
        longevity: d.longevityBps / 10000,
        stake: d.stakeBps / 10000,
      },
      // Published-score history (newest-first) — the operator's "why did my score move" trail.
      reputationHistory: deps.snapshots.listByWallet(wallet, 90),
      // All flags against me, INCLUDING reviewed ones (the public /v1/nodes hides reviewed).
      flags: deps.nodeFlags.forWallet(wallet),
      // Recent Layer-A verdicts on my jobs (hashes/scores only — never prompt text).
      recentVerdicts: deps.layerAChecks
        .forProviderSince(wallet, now - 30 * DAY_MS)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50),
      // Time-to-first-token samples (ms) over the last 30d — the latency trend.
      ttftMs: deps.jobs.firstTokenMsSince(wallet, now - 30 * DAY_MS),
    });
  });
}
