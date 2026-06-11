import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  creditAccountAbi,
  jobEscrowAbi,
  makePublicClient,
  makeWalletClient,
  nodeRegistryAbi,
  protocolTreasuryAbi,
  stakingRewardsAbi,
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

/** A node row from GET /v1/nodes with the Slice 4 dimension breakdown. */
interface NodeView {
  wallet: string;
  reputation: number;
  jobsServed: number;
  /** Open manual-review flags (Slice 5: Layer-A anomalies + output patterns). */
  flags: number;
  /** Earned, unclaimed staking rewards (Slice 6B), wei string. */
  claimableRewardsWei: string;
  dimensions: {
    accuracy: number;
    uptime: number;
    latency: number;
    longevity: number;
    stake: number;
  };
}

async function fetchNodes(baseUrl: string): Promise<NodeView[]> {
  return ((await (await fetch(`${baseUrl}/v1/nodes`)).json()) as { data: NodeView[] }).data;
}

/** The composite recomputed from the exposed dimensions with the spec weights. */
function recomputeComposite(d: NodeView['dimensions']): number {
  return (
    Math.round(
      10000 *
        (0.4 * d.accuracy + 0.25 * d.uptime + 0.15 * d.latency + 0.1 * d.longevity + 0.1 * d.stake),
    ) / 10000
  );
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
    assert.match(metricsText, /querais_nodes_connected 1/, '/metrics shows the connected node');

    // Dashboard data: stats.jobs + per-node leaderboard counter.
    const stats = (await (await fetch(`${h.baseUrl}/v1/stats`)).json()) as {
      jobs: { settled: number };
    };
    assert.ok(stats.jobs.settled >= 1, 'stats.jobs reflects activity');
    const nodesData = await fetchNodes(h.baseUrl);
    assert.ok((nodesData[0]?.jobsServed ?? 0) >= 1, 'node jobsServed increments (leaderboard)');

    // Slice 4: the displayed reputation is the 5-dimension composite and must equal the
    // weighted sum of the exposed dimension breakdown (no hidden inputs).
    const view = nodesData[0]!;
    assert.equal(
      view.reputation,
      recomputeComposite(view.dimensions),
      '/v1/nodes composite equals the recomputed weighted dimension sum',
    );
    assert.ok(view.dimensions.accuracy > 0.7, 'a verified pass nudges accuracy above the seed');
    assert.equal(view.dimensions.latency, 1.0, 'MockBackend first token is fast (<500ms)');
    assert.equal(view.dimensions.uptime, 1.0, 'connected since first seen');

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

    // Slice 4: a fresh gateway sees the node with the seeded accuracy (0.70) plus one
    // verified pass, and exposes the full dimension breakdown.
    const [view] = await fetchNodes(h.baseUrl);
    assert.ok(view, '/v1/nodes lists the connected node');
    assert.ok(
      view!.dimensions.accuracy >= 0.7 && view!.dimensions.accuracy < 0.71,
      `accuracy starts at the 0.70 onboarding seed (got ${view!.dimensions.accuracy})`,
    );
    assert.equal(
      view!.reputation,
      recomputeComposite(view!.dimensions),
      'composite equals the weighted dimension sum',
    );

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

/** A backend that serves correct output but takes ~1.2s to emit its first token. */
class SlowFirstTokenBackend implements InferenceBackend {
  readonly name = 'slow-first-token';
  constructor(private readonly delayMs = 1200) {}
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async listModels(): Promise<string[]> {
    return ['mock-model'];
  }
  async generate(
    req: InferenceRequest,
    onChunk: (chunk: InferenceChunk) => void,
  ): Promise<InferenceResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const words = `You said: ${lastUser?.content ?? ''}`.split(/\s+/).filter(Boolean);
    let content = '';
    words.forEach((word, i) => {
      const piece = (i === 0 ? '' : ' ') + word;
      content += piece;
      onChunk({ content: piece });
    });
    return { content, promptTokens: 1, completionTokens: words.length, finishReason: 'stop' };
  }
}

/**
 * Reputation snapshots (Slice 4B): a slow-first-token node is graded down on the
 * Latency dimension (~1200ms TTFT → 0.75), and the snapshot timer publishes the
 * composite on-chain on its own (interval shrunk to 2s) — the registry score
 * converges to exactly the weighted dimension sum that /v1/nodes reports.
 */
export async function runReputationCase(): Promise<void> {
  const h = await startHarness({
    backend: new SlowFirstTokenBackend(),
    reputationSnapshotIntervalSeconds: 2,
  });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const provider = h.deployment.accounts.node;

    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'take your time' }],
      max_tokens: 30,
    });
    assert.equal(res.status, 200, 'slow node still serves a verified job');

    // The slow first token lands in the Latency dimension and drags the composite.
    const [view] = await fetchNodes(h.baseUrl);
    assert.ok(view, '/v1/nodes lists the node');
    assert.equal(
      view!.dimensions.latency,
      0.75,
      `~1200ms TTFT grades the Latency dimension to 0.75 (got ${view!.dimensions.latency})`,
    );
    assert.equal(
      view!.reputation,
      recomputeComposite(view!.dimensions),
      'composite equals the weighted dimension sum',
    );
    const expectedBps = Math.round(view!.reputation * 10000);

    // The TIMER must land the snapshot on-chain by itself (no failure path involved).
    const deadline = Date.now() + 15_000;
    let onchainBps = -1;
    for (;;) {
      const node = await pub.readContract({
        address: h.deployment.contracts.nodeRegistry,
        abi: nodeRegistryAbi,
        functionName: 'getNode',
        args: [provider],
      });
      onchainBps = Number(node.reputationScore);
      if (onchainBps === expectedBps) break;
      assert.ok(
        Date.now() < deadline,
        `timed out waiting for the snapshot timer (on-chain ${onchainBps}, want ${expectedBps})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // The publish is also visible in the oracle's metrics.
    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(
      metricsText,
      /querais_reputation_snapshots_total [1-9]/,
      'snapshot publishes are counted',
    );
  } finally {
    await h.stop();
  }
}

/** A backend that returns the SAME canned reply to every prompt — Layer-B passes it
 *  (well-formed, hash-consistent), but it is exactly what Layer-A exists to catch. */
class CannedBackend implements InferenceBackend {
  readonly name = 'canned';
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
    const words = 'Thank you for your question, the answer is certainly 42.'.split(' ');
    let content = '';
    words.forEach((word, i) => {
      const piece = (i === 0 ? '' : ' ') + word;
      content += piece;
      onChunk({ content: piece });
    });
    return { content, promptTokens: 1, completionTokens: words.length, finishReason: 'stop' };
  }
}

/** Deterministic embeddings for e2e: character-trigram counts. Identical text → 1.0
 *  cosine, unrelated text → near 0 — real similarity behavior without a model. */
function trigramEmbeddings() {
  return {
    async embed(text: string): Promise<number[]> {
      const v = new Array<number>(64).fill(0);
      const s = text.toLowerCase();
      for (let i = 0; i + 3 <= s.length; i++) {
        let h = 0;
        for (let j = i; j < i + 3; j++) h = (h * 31 + s.charCodeAt(j)) >>> 0;
        v[h % 64]! += 1;
      }
      return v;
    },
  };
}

/**
 * Layer-A verification (Slice 5): a canned-output cheater passes Layer-B but the
 * semantic-sampling oracle (honest re-runs + embedding cosine similarity) catches it —
 * anomaly flags + an accuracy-EMA collapse — and the pattern sweep independently spots
 * the identical result hash across distinct prompts. Flags are manual-review only:
 * the node keeps serving (no auto-slash).
 */
export async function runLayerACase(): Promise<void> {
  const h = await startHarness({
    backend: new CannedBackend(),
    layerAConfig: { sampleRate: 1, oracleRuns: 2, patternScanIntervalSeconds: 1 },
    layerA: {
      // The oracle "re-runs" honestly echo the prompt (MockBackend semantics) — so the
      // cheater's canned reply lands far from every oracle output.
      inference: {
        generate: async (_model, messages) =>
          `You said: ${messages[messages.length - 1]?.content ?? ''}`,
      },
      embeddings: trigramEmbeddings(),
    },
  });
  try {
    const prompts = [
      'what is the capital of France?',
      'write a haiku about the sea',
      'explain how staking works',
    ];
    for (const prompt of prompts) {
      const res = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 50,
      });
      assert.equal(res.status, 200, 'the canned cheater still passes Layer-B');
    }

    // Sampling is async (fire-and-forget) and the pattern sweep runs on a 1s timer —
    // poll until all three anomaly flags + the duplicate-output pattern flag land.
    const deadline = Date.now() + 15_000;
    let view: NodeView | undefined;
    for (;;) {
      [view] = await fetchNodes(h.baseUrl);
      if ((view?.flags ?? 0) >= 4) break;
      assert.ok(
        Date.now() < deadline,
        `timed out waiting for layer-A + pattern flags (got ${String(view?.flags ?? 0)})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Three oracle anomalies (α=0.05 each) collapse accuracy well below the 0.70 seed.
    assert.ok(
      view!.dimensions.accuracy < 0.65,
      `anomalies collapse the accuracy EMA (got ${view!.dimensions.accuracy})`,
    );
    assert.equal(
      view!.reputation,
      recomputeComposite(view!.dimensions),
      'composite still equals the weighted dimension sum',
    );

    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(metricsText, /querais_layer_a_samples_total [1-9]/, 'samples counted');
    assert.match(metricsText, /querais_layer_a_anomalies_total [1-9]/, 'anomalies counted');
    assert.match(metricsText, /querais_pattern_flags_total [1-9]/, 'pattern flag counted');

    // Manual review only: the flagged node is NOT slashed and keeps serving.
    const again = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'still serving?' }],
      max_tokens: 50,
    });
    assert.equal(again.status, 200, 'flags never auto-slash or evict the node');
  } finally {
    await h.stop();
  }
}

/**
 * Dispute hook (Slice 5B): with disputes enabled, a Layer-A anomaly raises an on-chain
 * FAST-track dispute that the oracle auto-resolves — the cheater's stake is slashed 20%
 * and split exactly 50% burn / 30% challenger / 20% treasury, with the challenger's
 * bond returned. The full arbitration panel stays Phase 5; this is the spec's
 * clear-cut-case path, end-to-end on-chain.
 */
export async function runDisputeCase(): Promise<void> {
  const h = await startHarness({
    backend: new CannedBackend(),
    layerAConfig: {
      sampleRate: 1,
      oracleRuns: 2,
      patternScanIntervalSeconds: 3600, // patterns aren't under test here
      disputeOnAnomaly: true,
    },
    layerA: {
      inference: {
        generate: async (_model, messages) =>
          `You said: ${messages[messages.length - 1]?.content ?? ''}`,
      },
      embeddings: trigramEmbeddings(),
    },
  });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const provider = h.deployment.accounts.node;
    const gateway = h.deployment.accounts.gateway; // the oracle/challenger
    const treasury = h.deployment.treasury;

    const stakeOf = (): Promise<bigint> =>
      pub
        .readContract({
          address: h.deployment.contracts.nodeRegistry,
          abi: nodeRegistryAbi,
          functionName: 'getNode',
          args: [provider],
        })
        .then((n) => n.stakeAmount);
    const supplyOf = (): Promise<bigint> =>
      pub.readContract({
        address: h.deployment.contracts.token,
        abi: quaisTokenAbi,
        functionName: 'totalSupply',
      });

    const [s0, gw0, t0, supply0] = await Promise.all([
      stakeOf(),
      balanceOf(pub, h.deployment, gateway),
      balanceOf(pub, h.deployment, treasury),
      supplyOf(),
    ]);

    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'a question the canned node will not answer' }],
      max_tokens: 50,
    });
    assert.equal(res.status, 200, 'the cheater still passes Layer-B');
    // The triggering job itself settles 95/5 through the escrow — its fee also reaches
    // the treasury and its pay reaches the provider; net both out of the dispute math.
    const jobView = (await (
      await fetch(`${h.baseUrl}/v1/jobs/${res.headers.get('x-querais-job-id')}`)
    ).json()) as { protocolFee: string | null };
    const jobFee = BigInt(jobView.protocolFee ?? '0');

    // The dispute is fire-and-forget after the response — poll for the slash to land.
    const deadline = Date.now() + 20_000;
    let s1 = s0;
    for (;;) {
      s1 = await stakeOf();
      if (s1 < s0) break;
      assert.ok(Date.now() < deadline, 'timed out waiting for the on-chain dispute slash');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const slash = (s0 * 2000n) / 10000n;
    const burn = (slash * 5000n) / 10000n;
    const challengerCut = (slash * 3000n) / 10000n;
    const treasuryCut = slash - burn - challengerCut;
    assert.equal(s0 - s1, slash, 'defendant slashed exactly 20% of stake');

    const [gw1, t1, supply1] = await Promise.all([
      balanceOf(pub, h.deployment, gateway),
      balanceOf(pub, h.deployment, treasury),
      supplyOf(),
    ]);
    // Bond out + bond back nets to zero, leaving exactly the 30% challenger cut.
    assert.equal(gw1 - gw0, challengerCut, 'challenger nets the 30% cut (bond returned)');
    assert.equal(t1 - t0, treasuryCut + jobFee, 'treasury receives 20% of the slash (+ job fee)');
    assert.equal(supply0 - supply1, burn, '50% of the slash is burned (supply shrinks)');

    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(metricsText, /querais_layer_a_disputes_total [1-9]/, 'dispute counted');
  } finally {
    await h.stop();
  }
}

/**
 * Treasury tokenomics (Slice 6A): settlement fees accrue at the ProtocolTreasury
 * CONTRACT (it replaced the treasury EOA as fee recipient), and the gateway's keeper
 * timer sweeps them with distribute() — 20% burned (total supply shrinks), 20%
 * earmarked for stakers (parked until 6B), 60% retained for ops — conserving to the
 * wei, with zero changes to settlement code.
 */
export async function runTreasuryCase(): Promise<void> {
  const h = await startHarness({ treasuryDistributeIntervalSeconds: 2 });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl);
    const treasury = h.deployment.contracts.protocolTreasury;
    assert.ok(treasury, 'the deployment has a ProtocolTreasury contract');

    const treasuryRead = (
      fn: 'totalBurned' | 'totalToStakers' | 'opsRetainedWei' | 'pendingDistribution',
    ): Promise<bigint> =>
      pub.readContract({ address: treasury!, abi: protocolTreasuryAbi, functionName: fn });
    const supplyOf = (): Promise<bigint> =>
      pub.readContract({
        address: h.deployment.contracts.token,
        abi: quaisTokenAbi,
        functionName: 'totalSupply',
      });

    // Baselines BEFORE this scenario's jobs (earlier scenarios already accrued fees).
    // Since 6B the staker share transfers straight to the StakingRewards pool, so the
    // split is asserted via the treasury's monotonic counters, not the parked earmark.
    const [burned0, toStakers0, ops0, supply0] = await Promise.all([
      treasuryRead('totalBurned'),
      treasuryRead('totalToStakers'),
      treasuryRead('opsRetainedWei'),
      supplyOf(),
    ]);

    // A couple of jobs whose 5% fees land at the treasury contract.
    for (let i = 0; i < 2; i++) {
      const res = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `fees for the treasury ${i}` }],
        max_tokens: 30,
      });
      assert.equal(res.status, 200, `fee-generating job ${i} succeeds`);
    }
    const pendingBefore = await treasuryRead('pendingDistribution');
    assert.ok(pendingBefore > 0n, 'settlement fees accrued as pending distribution');

    // The keeper timer (2s here, daily in production) must sweep on its own.
    const deadline = Date.now() + 20_000;
    for (;;) {
      if ((await treasuryRead('pendingDistribution')) === 0n) break;
      assert.ok(Date.now() < deadline, 'timed out waiting for the treasury sweep timer');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const [burned1, toStakers1, ops1, supply1] = await Promise.all([
      treasuryRead('totalBurned'),
      treasuryRead('totalToStakers'),
      treasuryRead('opsRetainedWei'),
      supplyOf(),
    ]);
    const swept = burned1 - burned0 + (toStakers1 - toStakers0) + (ops1 - ops0);
    assert.ok(swept >= pendingBefore, 'everything pending was swept');
    assert.equal(burned1 - burned0, (swept * 2000n) / 10000n, '20% burned');
    assert.equal(toStakers1 - toStakers0, (swept * 2000n) / 10000n, '20% to the staker pool');
    assert.equal(
      ops1 - ops0,
      swept - (burned1 - burned0) - (toStakers1 - toStakers0),
      '60% ops = exact remainder (conservation to the wei)',
    );
    assert.equal(supply0 - supply1, burned1 - burned0, 'the burn shrinks total supply');

    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(metricsText, /querais_treasury_distributions_total [1-9]/, 'sweep counted');
  } finally {
    await h.stop();
  }
}

/**
 * Staking rewards (Slice 6B, Option 1): the treasury's 20% staker share is credited
 * pro-rata to active staked nodes by the keeper's epoch step, and the node operator
 * pulls it with claim() — fee → sweep → epoch credit → claim, conserved end-to-end.
 */
export async function runStakingRewardsCase(): Promise<void> {
  const h = await startHarness({ treasuryDistributeIntervalSeconds: 2 });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl, h.deployment.chainId);
    const rewards = h.deployment.contracts.stakingRewards;
    assert.ok(rewards, 'the deployment has a StakingRewards contract');
    const provider = h.deployment.accounts.node;

    const claimableOf = (): Promise<bigint> =>
      pub.readContract({
        address: rewards!,
        abi: stakingRewardsAbi,
        functionName: 'claimable',
        args: [provider],
      });

    const claimable0 = await claimableOf();
    for (let i = 0; i < 2; i++) {
      const res = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `staker rewards ${i}` }],
        max_tokens: 30,
      });
      assert.equal(res.status, 200, `fee-generating job ${i} succeeds`);
    }

    // fee → treasury sweep → rewards epoch credit, all driven by the keeper timer.
    const deadline = Date.now() + 20_000;
    let claimable1 = claimable0;
    for (;;) {
      claimable1 = await claimableOf();
      if (claimable1 > claimable0) break;
      assert.ok(Date.now() < deadline, 'timed out waiting for the rewards epoch credit');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const earned = claimable1 - claimable0;

    // The single active node gets 100% of the staker share; /v1/nodes surfaces it.
    const [view] = await fetchNodes(h.baseUrl);
    assert.equal(view!.claimableRewardsWei, claimable1.toString(), '/v1/nodes shows earnings');

    // The operator claims: balance grows by exactly the earned amount.
    const nodeWallet = makeWalletClient(h.deployment.rpcUrl, KEYS.node, h.deployment.chainId);
    const b0 = await balanceOf(pub, h.deployment, provider);
    const claimHash = await nodeWallet.writeContract({
      address: rewards!,
      abi: stakingRewardsAbi,
      functionName: 'claim',
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: claimHash });
    assert.equal(receipt.status, 'success', 'claim succeeds');
    const b1 = await balanceOf(pub, h.deployment, provider);
    assert.equal(b1 - b0, claimable1, 'claim pays out exactly the credited rewards');
    assert.equal(await claimableOf(), 0n, 'claimable zeroed after the claim');
    assert.ok(earned > 0n, 'the staker share was non-trivial');

    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(metricsText, /querais_rewards_epochs_total [1-9]/, 'epoch credit counted');
  } finally {
    await h.stop();
  }
}

/** Run the REAL ops allocate script (cold-key payout) as a child process. */
function runAllocateScript(
  recipient: string,
  amountQais: string,
  purpose: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/allocate.ts',
        '--network',
        'localhost',
        '--recipient',
        recipient,
        '--amount',
        amountQais,
        '--purpose',
        purpose,
      ],
      {
        cwd: join(repoRoot(), 'packages', 'contracts'),
        shell: true,
        stdio: 'inherit',
        // On localhost the treasury admin is the deployer key, NOT the gateway key —
        // rehearses the production posture (payouts need the cold key).
        env: { ...process.env, ADMIN_PRIVATE_KEY: KEYS.deployer },
      },
    );
    proc.on('exit', (code) => resolve(code ?? 1));
    proc.on('error', reject);
  });
}

/**
 * Node incentives (Slice 6C): the gateway COMPUTES the payout recommendation
 * (first-model bonus here) from telemetry + chain state; the OPERATOR executes it from
 * the cold key with the real ops:allocate script; the on-chain Allocated purpose then
 * dedups the bonus out of the next recommendation. Read-only gateway, cold-key money.
 */
export async function runIncentivesCase(): Promise<void> {
  const h = await startHarness({
    treasuryDistributeIntervalSeconds: 2, // ops budget needs a sweep to exist
    incentives: { uptimePoolQais: 0, firstModelBonusQais: 25, bootstrapMinTenureDays: 30 },
  });
  try {
    const pub = makePublicClient(h.deployment.rpcUrl, h.deployment.chainId);
    const provider = h.deployment.accounts.node;

    // One verified job makes the node the first provider for mock-model.
    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'earn the first-model bonus' }],
      max_tokens: 30,
    });
    assert.equal(res.status, 200);

    // Give the treasury an ops budget: transfer "fees", let the keeper sweep (60% ops).
    const deployerWallet = makeWalletClient(
      h.deployment.rpcUrl,
      KEYS.deployer,
      h.deployment.chainId,
    );
    const fundHash = await deployerWallet.writeContract({
      address: h.deployment.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'transfer',
      args: [h.deployment.contracts.protocolTreasury!, parseEther('100')],
    });
    await pub.waitForTransactionReceipt({ hash: fundHash });

    const admin = { headers: { 'x-admin-token': ADMIN_TOKEN } };
    interface Rec {
      payouts: Array<{ recipient: string; amountQais: string; purpose: string; program: string }>;
      fundsSufficient: boolean;
      opsSpendableWei: string;
    }
    // Wait for the sweep to produce a spendable ops budget covering the bonus.
    const deadline = Date.now() + 20_000;
    let rec: Rec;
    for (;;) {
      rec = (await (await fetch(`${h.baseUrl}/v1/admin/incentives`, admin)).json()) as Rec;
      if (BigInt(rec.opsSpendableWei) >= parseEther('25') && rec.fundsSufficient) break;
      assert.ok(Date.now() < deadline, 'timed out waiting for a spendable ops budget');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const bonus = rec.payouts.find((p) => p.program === 'first-model');
    assert.ok(bonus, 'the first-model bonus is recommended');
    assert.equal(bonus!.recipient.toLowerCase(), provider.toLowerCase());
    assert.equal(bonus!.amountQais, '25');
    assert.match(bonus!.purpose, /^incentive:first-model:mock-model$/);
    // The endpoint is admin-gated.
    const unauthorized = await fetch(`${h.baseUrl}/v1/admin/incentives`);
    assert.equal(unauthorized.status, 401, 'incentives endpoint requires the admin token');

    // The OPERATOR pays the line with the real cold-key script.
    const b0 = await balanceOf(pub, h.deployment, provider);
    const code = await runAllocateScript(bonus!.recipient, bonus!.amountQais, bonus!.purpose);
    assert.equal(code, 0, 'allocate script must exit 0');
    const b1 = await balanceOf(pub, h.deployment, provider);
    assert.equal(b1 - b0, parseEther('25'), 'the bonus landed in the operator wallet');

    // The on-chain Allocated purpose dedups the bonus out of the next recommendation.
    const after = (await (await fetch(`${h.baseUrl}/v1/admin/incentives`, admin)).json()) as Rec;
    assert.equal(
      after.payouts.filter((p) => p.program === 'first-model').length,
      0,
      'a paid bonus never recommends again',
    );
  } finally {
    await h.stop();
  }
}

/**
 * Graceful shutdown (Slice 7A): a deploy/restart sends SIGTERM, which the gateway turns
 * into `app.close()` — the onClose hook flushes pending batched debits (money owed to
 * nodes) in one batchSettle before the process exits. Here we accrue debits BELOW the
 * flush threshold (so nothing settles during normal operation), then close the gateway
 * and prove the pending debits drained on-chain. The chain outlives the gateway, so we
 * read the settlement after shutdown.
 */
export async function runGracefulShutdownCase(): Promise<void> {
  const h = await startHarness({ batchFlushThreshold: 1000 }); // never auto-flushes here
  const pub = makePublicClient(h.deployment.rpcUrl, h.deployment.chainId);
  const credit = h.deployment.contracts.creditAccount;
  const requester = h.deployment.accounts.requester;

  const batchSettledCount = async (): Promise<number> =>
    (
      await pub.getContractEvents({
        address: credit,
        abi: creditAccountAbi,
        eventName: 'BatchSettled',
        args: { requester },
        fromBlock: 0n,
      })
    ).length;

  let drained = false;
  try {
    const reqWallet = makeWalletClient(h.deployment.rpcUrl, KEYS.requester, h.deployment.chainId);
    const deposit = parseEther('100');
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

    const sdk = new QueraisClient({
      baseUrl: h.baseUrl,
      apiKey: API_KEY,
      privateKey: KEYS.requester,
    });
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const opened = await sdk.openSession({
      maxSpendWei: deposit,
      nonce: 9n,
      deadline: nowSeconds + 3600n,
    });
    assert.equal(opened.ok, true, 'session should open');

    const flushesBefore = await batchSettledCount();
    for (let i = 0; i < 3; i++) {
      const res = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `pre-shutdown debit ${i}` }],
        max_tokens: 20,
      });
      assert.equal(res.status, 200, `job ${i} accrues a debit`);
    }
    const mid = await sdk.sessionStatus();
    assert.equal(mid.pendingDebits.count, 3, 'debits are pending, not yet flushed');
    assert.equal(await batchSettledCount(), flushesBefore, 'nothing settled below the threshold');

    // Graceful shutdown: stop() awaits app.close() — the SIGTERM drain path.
    await h.stop();
    drained = true;

    assert.equal(
      await batchSettledCount(),
      flushesBefore + 1,
      'graceful shutdown flushed the pending debits in one batchSettle',
    );
  } finally {
    if (!drained) await h.stop();
  }
}

/** The generic-format webhook body IS the Alert JSON (alerts.ts WebhookSink). */
interface WebhookAlert {
  key: string;
  rule: string;
  severity: string;
  title: string;
  detail: string;
  runbook: string;
  at: number;
}

/**
 * Observability (Slice 8): the full paging loop, end to end. The harness boots the
 * gateway with the webhook pointed at an in-process HTTP listener (the "human channel",
 * generic format, 1s cooldown/sweep, 2s debit-max-age). A Layer-A anomaly pushes a
 * `layer-a-anomaly` alert to the channel at flag time; the admin review queue shows it
 * open and a review drains it to zero (visible on /v1/nodes too). Debits held past the
 * age threshold fire `stuck-debits` from the sweep, and the flush recovers. The public
 * status page reports `ok` with live numbers, and /metrics carries the Slice 8 gauges
 * + histograms the Grafana dashboard reads.
 */
export async function runObservabilityCase(): Promise<void> {
  // 1. The "human channel": an in-process listener collecting every delivered alert.
  const received: WebhookAlert[] = [];
  const hook = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as WebhookAlert);
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const hookAddr = hook.address();
  if (!hookAddr || typeof hookAddr === 'string') throw new Error('failed to bind webhook port');
  const webhookUrl = `http://127.0.0.1:${String(hookAddr.port)}/alerts`;

  const waitForAlert = async (rule: string): Promise<WebhookAlert> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const hit = received.find((a) => a.rule === rule);
      if (hit) return hit;
      assert.ok(Date.now() < deadline, `timed out waiting for '${rule}' on the webhook`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  // Canned cheater + injected oracle (scenario 11's induction), plus tight alert knobs:
  // every alert delivers (info floor, 1s cooldown), the sweep runs every second, and a
  // debit counts as stuck after 2s. Threshold 3 holds the first two debits pending.
  const h = await startHarness({
    backend: new CannedBackend(),
    batchFlushThreshold: 3,
    layerAConfig: { sampleRate: 1, oracleRuns: 2, patternScanIntervalSeconds: 3600 },
    layerA: {
      inference: {
        generate: async (_model, messages) =>
          `You said: ${messages[messages.length - 1]?.content ?? ''}`,
      },
      embeddings: trigramEmbeddings(),
    },
    alerts: {
      webhookUrl,
      webhookFormat: 'generic',
      minSeverity: 'info',
      cooldownSeconds: 1,
      sweepIntervalSeconds: 1,
      debitMaxAgeSeconds: 2,
    },
  });
  try {
    const admin = { 'x-admin-token': ADMIN_TOKEN };

    // 2. Induce a Layer-A anomaly → the push alert reaches the channel at flag time.
    const res = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'what is the capital of France?' }],
      max_tokens: 50,
    });
    assert.equal(res.status, 200, 'the canned cheater still passes Layer-B');
    const anomaly = await waitForAlert('layer-a-anomaly');
    assert.equal(anomaly.severity, 'critical', 'layer-a-anomaly pages at critical');
    assert.ok(anomaly.runbook.endsWith('#layer-a-anomaly'), 'the alert links its runbook section');

    // 3. The review queue: the flag is open, a review closes it, every surface agrees.
    interface FlagsView {
      flags: Array<{ id: number; status: string }>;
      openCount: number;
    }
    const open = (await (
      await fetch(`${h.baseUrl}/v1/admin/flags?status=open`, { headers: admin })
    ).json()) as FlagsView;
    assert.ok(open.openCount >= 1, 'the anomaly flag is open in the review queue');
    for (const flag of open.flags) {
      const reviewed = await fetch(`${h.baseUrl}/v1/admin/flags/${String(flag.id)}/review`, {
        method: 'POST',
        headers: { ...admin, 'content-type': 'application/json' },
        body: JSON.stringify({ by: 'e2e', note: 'observability scenario review' }),
      });
      assert.equal(reviewed.status, 200, `flag ${String(flag.id)} reviews cleanly`);
    }
    const after = (await (
      await fetch(`${h.baseUrl}/v1/admin/flags?status=open`, { headers: admin })
    ).json()) as FlagsView;
    assert.equal(after.openCount, 0, 'reviews drain the queue to zero');
    const [nodeView] = await fetchNodes(h.baseUrl);
    assert.equal(nodeView?.flags, 0, '/v1/nodes flag count drops back to 0 after review');

    // 4. Hold debits past the age threshold → the sweep fires `stuck-debits`.
    const pub = makePublicClient(h.deployment.rpcUrl, h.deployment.chainId);
    const credit = h.deployment.contracts.creditAccount;
    const reqWallet = makeWalletClient(h.deployment.rpcUrl, KEYS.requester, h.deployment.chainId);
    const deposit = parseEther('100');
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
    const sdk = new QueraisClient({
      baseUrl: h.baseUrl,
      apiKey: API_KEY,
      privateKey: KEYS.requester,
    });
    const opened = await sdk.openSession({
      maxSpendWei: deposit,
      nonce: 11n,
      deadline: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
    });
    assert.equal(opened.ok, true, 'session should open');
    for (let i = 0; i < 2; i++) {
      const job = await chat(h.baseUrl, {
        model: 'mock-model',
        messages: [{ role: 'user', content: `held debit ${i}` }],
        max_tokens: 20,
      });
      assert.equal(job.status, 200, `job ${i} accrues a pending debit`);
    }
    const stuck = await waitForAlert('stuck-debits');
    assert.equal(stuck.severity, 'critical', 'unpaid providers page at critical');

    // While stuck: the Grafana-facing gauge + latency histogram are live on /metrics.
    const duringStuck = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(
      duringStuck,
      /querais_oldest_pending_debit_age_seconds [1-9]/,
      'the oldest-debit-age gauge reports the stuck debit',
    );
    assert.match(
      duringStuck,
      /querais_job_duration_seconds_bucket\{le="/,
      'the job-duration histogram renders cumulative buckets',
    );

    // 5. Recovery: the third job tips the threshold → one flush drains the ledger.
    const last = await chat(h.baseUrl, {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'held debit 2 (tips the flush)' }],
      max_tokens: 20,
    });
    assert.equal(last.status, 200, 'the tipping job succeeds');
    const drainDeadline = Date.now() + 15_000;
    for (;;) {
      const status = await sdk.sessionStatus();
      if (status.pendingDebits.count === 0) break;
      assert.ok(Date.now() < drainDeadline, 'timed out waiting for the flush to drain debits');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // 6. The public status page: `ok`, live numbers, and nothing sensitive.
    const statusBody = (await (await fetch(`${h.baseUrl}/v1/status`)).json()) as {
      status: string;
      nodes: number;
      rpcOk: boolean;
      jobs24h: number;
    };
    assert.equal(statusBody.status, 'ok', '/v1/status reports ok once recovered');
    assert.equal(statusBody.rpcOk, true, 'RPC probe passes');
    assert.equal(statusBody.nodes, 1, 'the connected node is counted');
    assert.ok(statusBody.jobs24h >= 1, 'the 24h job count is live');

    // 7. The alert pipeline's own metrics moved.
    const metricsText = await (await fetch(`${h.baseUrl}/metrics`)).text();
    assert.match(
      metricsText,
      /querais_alerts_delivered_total [1-9]/,
      'deliveries are counted on /metrics',
    );
  } finally {
    await h.stop();
    await new Promise<void>((resolve, reject) => {
      hook.close((err) => (err ? reject(err) : resolve()));
    });
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
    const [before] = await fetchNodes(h.baseUrl);

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

    // Slice 4: the flaky node's composite reflects the failure immediately — the
    // accuracy EMA takes a FAIL_ALPHA hit (0.70 → 0.665) and the slash shrinks the
    // Stake dimension; both drag the composite below its pre-failure value.
    const [after] = await fetchNodes(h.baseUrl);
    assert.ok(before && after, '/v1/nodes lists the node before and after');
    assert.ok(
      after!.dimensions.accuracy < 0.7,
      `accuracy drops below the seed after a verified failure (got ${after!.dimensions.accuracy})`,
    );
    assert.ok(
      after!.dimensions.stake < before!.dimensions.stake,
      'the slash is visible in the Stake dimension',
    );
    assert.ok(after!.reputation < before!.reputation, 'the composite drops after a failure');
    assert.equal(
      after!.reputation,
      recomputeComposite(after!.dimensions),
      'composite equals the weighted dimension sum',
    );

    // Slice 4B: a slashing event publishes on-chain IMMEDIATELY (slash first, then
    // publish — the Stake dimension already reflects the smaller stake), without
    // waiting for the daily snapshot sweep.
    const onchain = await pub.readContract({
      address: h.deployment.contracts.nodeRegistry,
      abi: nodeRegistryAbi,
      functionName: 'getNode',
      args: [provider],
    });
    assert.equal(
      Number(onchain.reputationScore),
      Math.round(after!.reputation * 10000),
      'the post-slash composite is published on-chain immediately',
    );
  } finally {
    await h.stop();
  }
}
