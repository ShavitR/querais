/**
 * Self-contained end-to-end acceptance gate (`pnpm test:e2e`).
 *
 * Spins up a fresh Hardhat node, deploys the contracts, then runs every scenario —
 * from the slice-0 success case (real mock completion + 95/5 on-chain settlement)
 * through hardening, reputation, verification, disputes, treasury, observability,
 * and the Slice 9 model manifest. Tears the chain down at the end. Uses the
 * MockBackend so it runs without Ollama; the live-inference path is covered by the
 * node-daemon smoke + `pnpm demo`.
 */
import { startChainAndDeploy } from './chain.js';
import {
  runSuccessCase,
  runFailureCase,
  runBatchedSettlementCase,
  runOpsCase,
  runOnboardingCase,
  runFaucetCase,
  runHardeningCase,
  runPauseDrillCase,
  runReputationCase,
  runLayerACase,
  runDisputeCase,
  runTreasuryCase,
  runStakingRewardsCase,
  runIncentivesCase,
  runGracefulShutdownCase,
  runObservabilityCase,
  runModelManifestCase,
  runServedAppCase,
} from './e2e.js';
import { runOpenAiParityCase } from './parity.js';

async function main(): Promise<void> {
  console.log('⛓  starting local chain + deploying contracts…');
  const chain = await startChainAndDeploy();
  let ok = false;
  try {
    console.log('▶  success case: request → match → settle (95/5)…');
    await runSuccessCase();
    console.log('✅ success case passed');

    console.log('▶  failure case: garbage result → Layer-B reject → refund…');
    await runFailureCase();
    console.log('✅ failure case passed');

    console.log('▶  batched settlement case: 10 jobs → 1 batchSettle tx, 0 requester txs…');
    await runBatchedSettlementCase();
    console.log('✅ batched settlement case passed');

    console.log('▶  parity case: official OpenAI SDK against the gateway…');
    await runOpenAiParityCase();
    console.log('✅ OpenAI parity case passed');

    console.log('▶  ops case: metrics + readiness + rate limiting…');
    await runOpsCase();
    console.log('✅ ops case passed');

    console.log('▶  onboarding case: admin issues a key → key serves a job…');
    await runOnboardingCase();
    console.log('✅ onboarding case passed');

    console.log('▶  faucet case: fresh address claims QAIS once…');
    await runFaucetCase();
    console.log('✅ faucet case passed');

    console.log('▶  hardening case: quotas 429, prompt limits 400, faucet IP throttle…');
    await runHardeningCase();
    console.log('✅ hardening case passed');

    console.log('▶  pause drill: real ops script pauses → chat fails → unpause restores…');
    await runPauseDrillCase();
    console.log('✅ pause drill passed');

    console.log('▶  reputation case: slow node graded down → snapshot timer publishes on-chain…');
    await runReputationCase();
    console.log('✅ reputation case passed');

    console.log('▶  layer-A case: canned-output cheater caught by semantic sampling + patterns…');
    await runLayerACase();
    console.log('✅ layer-A case passed');

    console.log('▶  dispute case: anomaly → on-chain dispute → 20% slash split 50/30/20…');
    await runDisputeCase();
    console.log('✅ dispute case passed');

    console.log('▶  treasury case: fees accrue → keeper sweep → 20/20/60 burn/stakers/ops…');
    await runTreasuryCase();
    console.log('✅ treasury case passed');

    console.log('▶  staking rewards case: staker share → pro-rata epoch credit → claim…');
    await runStakingRewardsCase();
    console.log('✅ staking rewards case passed');

    console.log('▶  incentives case: recommendation → cold-key allocate → on-chain dedup…');
    await runIncentivesCase();
    console.log('✅ incentives case passed');

    console.log('▶  graceful shutdown: pending debits drain on SIGTERM (app.close)…');
    await runGracefulShutdownCase();
    console.log('✅ graceful shutdown case passed');

    console.log(
      '▶  observability case: anomaly → webhook page → review; stuck debits → alert → recover…',
    );
    await runObservabilityCase();
    console.log('✅ observability case passed');

    console.log(
      '▶  model manifest case: poisoned pin → boot refusal + handshake drop; matching pin serves…',
    );
    await runModelManifestCase();
    console.log('✅ model manifest case passed');

    console.log('▶  served-app case: gateway serves the web app at / + API-key cookie sign-in…');
    await runServedAppCase();
    console.log('✅ served-app case passed');

    ok = true;
    console.log('\n🎉 E2E PASSED — full slice works: inference returned AND settled on-chain');
  } catch (err) {
    console.error('\n❌ E2E FAILED');
    console.error(err);
  } finally {
    await chain.stop();
  }
  process.exit(ok ? 0 : 1);
}

void main();
