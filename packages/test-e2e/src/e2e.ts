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

/** A node row from GET /v1/nodes with the Slice 4 dimension breakdown. */
interface NodeView {
  wallet: string;
  reputation: number;
  jobsServed: number;
  /** Open manual-review flags (Slice 5: Layer-A anomalies + output patterns). */
  flags: number;
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
    assert.match(metricsText, /querais_nodes 1/, '/metrics shows the connected node');

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
