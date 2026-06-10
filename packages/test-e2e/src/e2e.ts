import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  creditAccountAbi,
  jobEscrowAbi,
  makePublicClient,
  makeWalletClient,
  nodeRegistryAbi,
  quaisTokenAbi,
  splitPayment,
  type Deployment,
  type QueraisPublicClient,
} from '@querais/shared';
import type {
  InferenceBackend,
  InferenceChunk,
  InferenceRequest,
  InferenceResult,
} from '@querais/node-daemon';
import { QueraisClient } from '@querais/sdk';
import { startHarness, API_KEY, ADMIN_TOKEN, KEYS } from './harness.js';
import { repoRoot } from './chain.js';

function balanceOf(pub: QueraisPublicClient, dep: Deployment, addr: Address): Promise<bigint> {
  return pub.readContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'balanceOf',
    args: [addr],
  });
}

async function chat(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
}

/**
 * Happy path: a real (mock) completion comes back AND the escrow settles exactly
 * 95% provider / 5% treasury / refund, with the job marked VERIFIED on-chain.
 */
export async function runSuccessCase(): Promise<void> {
  const h = await startHarness(); // default ChainSettlement + MockBackend
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const { node: provider, requester } = h.deployment.accounts;
    const treasury = h.deployment.treasury;

    const [p0, t0, r0] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      balanceOf(pub, h.deployment, requester),
    ]);

    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'hello world' }],
      max_tokens: 50,
    });
    assert.equal(res.status, 200, 'expected HTTP 200');
    const jobId = res.headers.get('x-querais-job-id') as Hex | null;
    assert.ok(jobId, 'expected x-querais-job-id header');
    const responseBody = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    assert.match(responseBody.choices[0]!.message.content, /You said: hello world/);

    const job = await pub.readContract({
      address: h.deployment.contracts.jobEscrow,
      abi: jobEscrowAbi,
      functionName: 'getJob',
      args: [jobId],
    });
    assert.equal(job.status, 4, 'job should be VERIFIED'); // VERIFIED == 4

    const actualPayment = job.agreedPricePerToken * job.actualTokens;
    const { providerPay, fee } = splitPayment(actualPayment);

    const [p1, t1, r1] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      balanceOf(pub, h.deployment, requester),
    ]);

    assert.equal(p1 - p0, providerPay, 'provider should receive 95%');
    assert.equal(t1 - t0, fee, 'treasury should receive 5%');
    assert.equal(r1 - r0, -actualPayment, 'requester net cost == actual payment (rest refunded)');
    assert.equal(providerPay + fee, actualPayment, 'conservation: pay + fee == payment');
  } finally {
    await h.stop();
  }
}

function creditBalanceOf(
  pub: QueraisPublicClient,
  credit: Address,
  addr: Address,
): Promise<bigint> {
  return pub.readContract({
    address: credit,
    abi: creditAccountAbi,
    functionName: 'balanceOf',
    args: [addr],
  });
}

/**
 * Batched session-deposit settlement (Slice 2): the requester deposits once + signs ONE
 * EIP-712 cap, then fires N jobs that all settle in a SINGLE on-chain batchSettle tx — with
 * the requester sending zero per-call wallet txs and the 95/5 split landing on-chain.
 */
export async function runBatchedSettlementCase(): Promise<void> {
  const JOBS = 100; // the acceptance bar: 100 calls settle in ONE on-chain tx
  const h = await startHarness({ batchFlushThreshold: JOBS });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl, h.deployment.chainId);
    const credit = h.deployment.contracts.creditAccount;
    const provider = h.deployment.accounts.node;
    const requester = h.deployment.accounts.requester;
    const treasury = h.deployment.treasury;

    // Requester deposits into the CreditAccount (one on-chain tx) and approves it.
    const reqWallet = makeWalletClient(h.deployment.rpcUrl, KEYS.requester, h.deployment.chainId);
    const deposit = parseEther('500');
    const approveHash = await reqWallet.writeContract({
      address: h.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'approve',
      args: [credit, deposit],
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });
    const depositHash = await reqWallet.writeContract({
      address: credit,
      abi: creditAccountAbi,
      functionName: 'deposit',
      args: [deposit],
    });
    await pub.waitForTransactionReceipt({ hash: depositHash });

    // Sign ONE spending cap off-chain via the SDK and register the session.
    const sdk = new QueraisClient({
      baseUrl: h.baseUrl,
      apiKey: API_KEY,
      privateKey: KEYS.requester,
    });
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const opened = await sdk.openSession({
      maxSpendWei: deposit,
      nonce: 1n,
      deadline: nowSeconds + 3600n,
    });
    assert.equal(opened.ok, true, 'session should open');

    // Session status (Slice 3B): a fresh session reports zero spend/pending and full headroom.
    const fresh = await sdk.sessionStatus();
    assert.ok(fresh.session, 'GET /v1/sessions reports the active session');
    assert.equal(fresh.session.spentAgainstWei, '0', 'nothing settled against a fresh cap');
    assert.equal(fresh.pendingDebits.count, 0, 'no pending debits before any job');
    assert.equal(fresh.credit.balanceWei, deposit.toString(), 'deposit visible on-chain');
    assert.equal(fresh.headroomWei, deposit.toString(), 'headroom == cap == deposit here');

    // Snapshot AFTER deposit/approve (so those don't count), BEFORE the jobs.
    const [p0, t0, c0] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      creditBalanceOf(pub, credit, requester),
    ]);
    const reqTxBefore = await pub.getTransactionCount({ address: requester });

    // Fire N jobs; each accrues a signed debit. The Nth triggers a single batchSettle.
    for (let i = 0; i < JOBS - 1; i++) {
      const res = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `batch ${i}` }],
        max_tokens: 20,
      });
      assert.equal(res.status, 200, `job ${i} should return 200`);
    }

    // Session status mid-run (before the flush): debits are pending, headroom is reduced.
    const midRun = await sdk.sessionStatus();
    assert.equal(midRun.pendingDebits.count, JOBS - 1, 'unflushed debits are visible');
    assert.ok(BigInt(midRun.pendingDebits.totalWei) > 0n, 'pending total accrues');
    assert.equal(midRun.session?.spentAgainstWei, '0', 'nothing on-chain until the flush');
    assert.ok(
      BigInt(midRun.headroomWei!) < BigInt(fresh.headroomWei!),
      'pending debits reduce headroom',
    );

    const last = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: `batch ${JOBS - 1}` }],
      max_tokens: 20,
    });
    assert.equal(last.status, 200, 'final job should return 200');

    // Exactly ONE on-chain batchSettle covered all N jobs.
    const events = await pub.getContractEvents({
      address: credit,
      abi: creditAccountAbi,
      eventName: 'BatchSettled',
      args: { requester },
      fromBlock: 0n,
    });
    assert.equal(events.length, 1, 'all jobs should settle in exactly one batchSettle tx');
    const ev = events[0]!.args as { jobCount: bigint; totalPaid: bigint; protocolFee: bigint };
    assert.equal(ev.jobCount, BigInt(JOBS), 'the one batch should cover every job');
    assert.ok(ev.totalPaid > 0n, 'some payment should have settled');

    // The requester signed ZERO per-call wallet txs (its on-chain nonce is unchanged).
    const reqTxAfter = await pub.getTransactionCount({ address: requester });
    assert.equal(reqTxAfter, reqTxBefore, 'requester sends zero per-call txs');

    // The 95/5 split landed on-chain and the deposit was debited by exactly the gross total.
    const [p1, t1, c1] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      creditBalanceOf(pub, credit, requester),
    ]);
    assert.equal(t1 - t0, ev.protocolFee, 'treasury receives the summed 5%');
    assert.equal(p1 - p0, ev.totalPaid - ev.protocolFee, 'provider receives the rest (95%)');
    assert.equal(c0 - c1, ev.totalPaid, 'deposit debited by exactly the gross total');

    // Session status post-flush: ledger drained, on-chain spend matches the settled total.
    const settled = await sdk.sessionStatus();
    assert.equal(settled.pendingDebits.count, 0, 'flush drains the pending ledger');
    assert.equal(
      settled.session?.spentAgainstWei,
      ev.totalPaid.toString(),
      'on-chain spentAgainst equals the batch total',
    );
  } finally {
    await h.stop();
  }
}

/**
 * Ops hardening: /metrics reflects activity, /ready responds, and per-key rate
 * limiting returns 429 past the threshold.
 */
export async function runOpsCase(): Promise<void> {
  const h = await startHarness({ rateLimitMax: 5 });
  try {
    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'metrics please' }],
      max_tokens: 20,
    });
    assert.equal(res.status, 200, 'warm-up job should succeed');

    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(metricsText, /querais_jobs_settled_total \d+/, '/metrics exposes counters');
    assert.match(metricsText, /querais_nodes 1/, '/metrics shows the connected node');

    // Dashboard data: stats.jobs + per-node leaderboard counter.
    const stats = (await (await fetch(`${h.baseUrl}/v1/stats`)).json()) as {
      jobs: { settled: number };
    };
    assert.ok(stats.jobs.settled >= 1, 'stats.jobs reflects activity');
    const nodesData = (
      (await (await fetch(`${h.baseUrl}/v1/nodes`)).json()) as {
        data: Array<{ jobsServed: number; reputation: number }>;
      }
    ).data;
    assert.ok((nodesData[0]?.jobsServed ?? 0) >= 1, 'node jobsServed increments (leaderboard)');

    // Reputation shown by /v1/nodes must match the live on-chain value (cache refresh).
    const pub = makePublicClient(h.deployment.rpcUrl);
    const onchain = await pub.readContract({
      address: h.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'getNode',
      args: [h.deployment.accounts.node],
    });
    assert.equal(
      nodesData[0]?.reputation,
      Number(onchain.reputationScore) / 10000,
      '/v1/nodes reputation reflects on-chain (refreshed after settlement)',
    );

    const ready = (await (await fetch(`${h.baseUrl}/ready`)).json()) as { ready: boolean };
    assert.equal(ready.ready, true, '/ready responds');

    // Persistence (Slice 1): the settled job is mirrored in the DB and surfaced by the routes.
    const jobId = res.headers.get('x-querais-job-id');
    assert.ok(jobId, 'settled job exposes its id');
    const jobView = (await (await fetch(`${h.baseUrl}/v1/jobs/${jobId}`)).json()) as {
      status: string;
      model: string | null;
      providerPay: string | null;
    };
    assert.equal(jobView.status, 'verified', '/v1/jobs reports on-chain status');
    assert.equal(jobView.model, 'mock-model', '/v1/jobs includes the persisted model');
    assert.ok(
      jobView.providerPay != null && BigInt(jobView.providerPay) > 0n,
      '/v1/jobs includes the persisted settlement split',
    );

    const usage = (await (
      await fetch(`${h.baseUrl}/v1/usage`, { headers: { authorization: `Bearer ${API_KEY}` } })
    ).json()) as { jobs: number; tokens: number; spentWei: string };
    assert.ok(usage.jobs >= 1, '/v1/usage counts settled jobs');
    assert.ok(usage.tokens >= 1, '/v1/usage sums tokens');
    assert.ok(BigInt(usage.spentWei) > 0n, '/v1/usage sums spend (derived from settled jobs)');

    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${h.baseUrl}/v1/models`, {
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    assert.ok(got429, 'rate limit should return 429 past the threshold');
  } finally {
    await h.stop();
  }
}

/**
 * Onboarding: an admin issues a fresh API key for a wallet, that key works for a job,
 * and issuance is gated by the admin token.
 */
export async function runOnboardingCase(): Promise<void> {
  const h = await startHarness();
  try {
    // Admin issues a key for the requester wallet (funded + escrow-approved by the harness).
    const issue = await fetch(`${h.baseUrl}/v1/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ wallet: h.requester }),
    });
    assert.equal(issue.status, 200, 'admin can issue a key');
    const issued = (await issue.json()) as { api_key: string };
    assert.match(issued.api_key, /^sk-querais-/, 'issued key has the expected prefix');

    // The freshly issued key works for a real job.
    const res = await fetch(`${h.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${issued.api_key}` },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'issued key works' }],
        max_tokens: 30,
      }),
    });
    assert.equal(res.status, 200, 'issued key authenticates a job');
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    assert.match(body.choices[0]!.message.content, /You said: issued key works/);

    // Issuance is gated: wrong admin token is rejected.
    const bad = await fetch(`${h.baseUrl}/v1/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'wrong' },
      body: JSON.stringify({ wallet: h.requester }),
    });
    assert.equal(bad.status, 401, 'bad admin token rejected');
  } finally {
    await h.stop();
  }
}

/** Faucet: a fresh address claims testnet QAIS once; a second claim is refused. */
export async function runFaucetCase(): Promise<void> {
  const h = await startHarness();
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const fresh = privateKeyToAccount(generatePrivateKey()).address;

    const before = await balanceOf(pub, h.deployment, fresh);
    const res = await fetch(`${h.baseUrl}/v1/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: fresh }),
    });
    assert.equal(res.status, 200, 'faucet dispenses QAIS');
    const after = await balanceOf(pub, h.deployment, fresh);
    assert.ok(after > before, 'fresh address received QAIS from the faucet');

    const again = await fetch(`${h.baseUrl}/v1/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: fresh }),
    });
    assert.equal(again.status, 429, 'second claim from the same address is refused');
  } finally {
    await h.stop();
  }
}

/**
 * Surface hardening (Slice 3): per-key daily quotas return 429 with quota headers once
 * the budget is burned, prompt-abuse limits return 400 before any chain interaction,
 * and the faucet's per-IP throttle blocks fresh addresses from the same source.
 */
export async function runHardeningCase(): Promise<void> {
  const h = await startHarness({
    hardening: {
      quotaTiers: { free: { dailyJobs: 2, dailyTokens: 1_000_000 } },
      maxPromptChars: 200,
      faucetIpDailyLimit: 2,
    },
  });
  try {
    // 1. Prompt limits: an oversized prompt is refused with 400 (no chain interaction).
    // (Run before the quota is burned — quota is checked first in the route.)
    const big = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'x'.repeat(500) }],
      max_tokens: 20,
    });
    assert.equal(big.status, 400, 'oversized prompt is refused');

    // 2. Quota: the free tier allows 2 jobs/day — the 3rd is refused with headers.
    for (let i = 0; i < 2; i++) {
      const ok = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `quota ${i}` }],
        max_tokens: 20,
      });
      assert.equal(ok.status, 200, `job ${i} within quota should succeed`);
    }
    const over = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'one too many' }],
      max_tokens: 20,
    });
    assert.equal(over.status, 429, 'job beyond the daily quota is refused');
    assert.equal(over.headers.get('x-querais-quota-remaining-jobs'), '0');
    const overBody = (await over.json()) as { error: { type: string } };
    assert.equal(overBody.error.type, 'quota_exceeded');

    // 3. Faucet per-IP throttle: fresh addresses, same source IP — the 3rd is refused.
    const claim = (addr: string) =>
      fetch(`${h.baseUrl}/v1/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      });
    const a1 = await claim(privateKeyToAccount(generatePrivateKey()).address);
    const a2 = await claim(privateKeyToAccount(generatePrivateKey()).address);
    const a3 = await claim(privateKeyToAccount(generatePrivateKey()).address);
    assert.equal(a1.status, 200, 'first claim from this IP succeeds');
    assert.equal(a2.status, 200, 'second claim from this IP succeeds');
    assert.equal(a3.status, 429, 'third claim from the same IP is throttled');
  } finally {
    await h.stop();
  }
}

/** Run the REAL ops pause script (packages/contracts/scripts/pause.ts) as a child process. */
function runPauseScript(action: 'status' | 'pause' | 'unpause'): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'pnpm',
      ['exec', 'tsx', 'scripts/pause.ts', action, '--network', 'localhost'],
      {
        cwd: join(repoRoot(), 'packages', 'contracts'),
        shell: true,
        stdio: 'inherit', // drill output belongs in the e2e log
        // On localhost the PAUSER is the deployer/admin key, NOT the gateway key —
        // this rehearses the production posture (pause works without the hot key).
        env: { ...process.env, PAUSER_PRIVATE_KEY: KEYS.deployer },
      },
    );
    proc.on('exit', (code) => resolve(code ?? 1));
    proc.on('error', reject);
  });
}

/**
 * Emergency pause drill (Slice 3B): exercises the real incident tooling end-to-end.
 * Pausing the contracts makes new work fail (chat 5xx) while the gateway itself stays
 * up (/health 200); unpausing restores normal service. This is the permanent local
 * regression for the runbook's "Immediate response" procedure (docs/RUNBOOK_KEYS.md).
 */
export async function runPauseDrillCase(): Promise<void> {
  const h = await startHarness();
  try {
    const warm = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'pre-drill warm-up' }],
      max_tokens: 20,
    });
    assert.equal(warm.status, 200, 'service healthy before the drill');

    try {
      assert.equal(await runPauseScript('pause'), 0, 'pause script must exit 0');

      const paused = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: 'should fail while paused' }],
        max_tokens: 20,
      });
      assert.ok(
        paused.status >= 500,
        `chat must fail while contracts are paused (got ${paused.status})`,
      );
      const health = await fetch(`${h.baseUrl}/health`);
      assert.equal(health.status, 200, 'gateway /health stays up while paused');
    } finally {
      // Always unpause — later scenarios share this chain. Idempotent if pause failed.
      assert.equal(await runPauseScript('unpause'), 0, 'unpause script must exit 0');
    }

    const restored = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'post-drill recovery' }],
      max_tokens: 20,
    });
    assert.equal(restored.status, 200, 'service restored after unpause');
  } finally {
    await h.stop();
  }
}

/** A backend that emits a degenerate repetition loop, which Layer-B must reject. */
class LoopBackend implements InferenceBackend {
  readonly name = 'loop';
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async listModels(): Promise<string[]> {
    return ['mock-model'];
  }
  async generate(
    _req: InferenceRequest,
    onChunk: (chunk: InferenceChunk) => void,
  ): Promise<InferenceResult> {
    let content = '';
    for (let i = 0; i < 50; i++) {
      const piece = (i === 0 ? '' : ' ') + 'na';
      content += piece;
      onChunk({ content: piece });
    }
    return { content, promptTokens: 1, completionTokens: 50, finishReason: 'stop' };
  }
}

/**
 * Failure path: a node returns garbage (a repetition loop). Layer-B rejects it, the
 * gateway returns 502, and the escrow fully refunds the requester — provider and
 * treasury are paid nothing.
 */
export async function runFailureCase(): Promise<void> {
  const h = await startHarness({ backend: new LoopBackend() });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const { node: provider, requester } = h.deployment.accounts;
    const treasury = h.deployment.treasury;

    const stakeOf = (wallet: Address): Promise<bigint> =>
      pub
        .readContract({
          address: h.deployment.contracts.nodeRegistry,
          abi: nodeRegistryAbi,
          functionName: 'getNode',
          args: [wallet],
        })
        .then((n) => n.stakeAmount);

    const [p0, t0, r0, s0] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      balanceOf(pub, h.deployment, requester),
      stakeOf(provider),
    ]);

    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'please loop' }],
      max_tokens: 100,
    });
    assert.equal(res.status, 502, 'expected HTTP 502 (verification failure)');

    const [p1, t1, r1, s1] = await Promise.all([
      balanceOf(pub, h.deployment, provider),
      balanceOf(pub, h.deployment, treasury),
      balanceOf(pub, h.deployment, requester),
      stakeOf(provider),
    ]);

    assert.equal(p1, p0, 'provider must be paid nothing on failure');
    assert.equal(t1, t0, 'treasury must be paid nothing on failure');
    assert.equal(r1, r0, 'requester must be fully refunded on failure');
    assert.ok(s1 < s0, 'provider stake must be slashed on a verified-bad result');
  } finally {
    await h.stop();
  }
}
