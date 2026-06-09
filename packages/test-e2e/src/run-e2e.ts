/**
 * Self-contained end-to-end acceptance gate (`pnpm test:e2e`).
 *
 * Spins up a fresh Hardhat node, deploys the contracts, then runs the full slice
 * twice: a success case (real mock completion + 95/5 on-chain settlement, job
 * VERIFIED) and a failure case (Layer-B rejects a garbage result → 502 + full
 * refund). Tears the chain down at the end. Uses the MockBackend so it runs without
 * Ollama; the live-inference path is covered by the node-daemon smoke + `pnpm demo`.
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
