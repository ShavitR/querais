import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, Hex } from 'viem';
import { GatewayDb } from './db/index.js';
import { JobStore } from './db/jobs.js';
import { ApiKeyStore } from './key-store.js';
import { QuotaEnforcer, validatePromptLimits } from './quota.js';
import { HARDENING_DEFAULTS, resolveHardening } from './config.js';
import type { ChatCompletionRequest } from '@querais/shared';

const WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address;

function jobId(n: number): Hex {
  return ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex;
}

function seedJobs(jobs: JobStore, count: number, tokensEach = 10): void {
  for (let i = 1; i <= count; i++) {
    jobs.recordAssigned({
      jobId: jobId(i),
      requester: WALLET,
      provider: WALLET,
      model: 'mock-model',
      maxTokens: 100,
      agreedPriceWei: 1n,
      lockedWei: 100n,
    });
    jobs.markSettled(jobId(i), {
      actualTokens: tokensEach,
      paymentWei: BigInt(tokensEach),
      providerPayWei: BigInt(tokensEach - 1),
      feeWei: 1n,
    });
  }
}

function enforcer(db: GatewayDb, tiers = HARDENING_DEFAULTS.quotaTiers) {
  const keys = new ApiKeyStore(db, new Map([['sk-test', WALLET]]));
  return new QuotaEnforcer(new JobStore(db), keys, tiers);
}

test('quota verdict reflects tier budgets minus rolling-window usage', () => {
  const db = new GatewayDb();
  const jobs = new JobStore(db);
  seedJobs(jobs, 3, 50);
  const q = enforcer(db, { free: { dailyJobs: 5, dailyTokens: 1_000 } });

  const v = q.check('sk-test', WALLET);
  assert.equal(v.ok, true);
  assert.equal(v.tier, 'free');
  assert.equal(v.remainingJobs, 2); // 5 - 3
  assert.equal(v.remainingTokens, 850); // 1000 - 150
});

test('job budget exhausted → not ok (failed attempts burn quota too)', () => {
  const db = new GatewayDb();
  const jobs = new JobStore(db);
  seedJobs(jobs, 2);
  // A failed job still counts toward the job budget.
  jobs.recordAssigned({
    jobId: jobId(99),
    requester: WALLET,
    provider: WALLET,
    model: 'mock-model',
    maxTokens: 100,
    agreedPriceWei: 1n,
    lockedWei: 100n,
  });
  jobs.markFailed(jobId(99), 'verification failed');

  const q = enforcer(db, { free: { dailyJobs: 3, dailyTokens: 1_000_000 } });
  const v = q.check('sk-test', WALLET);
  assert.equal(v.remainingJobs, 0);
  assert.equal(v.ok, false);
});

test('token budget exhausted → not ok even with job headroom', () => {
  const db = new GatewayDb();
  seedJobs(new JobStore(db), 2, 600);
  const q = enforcer(db, { free: { dailyJobs: 100, dailyTokens: 1_000 } });
  const v = q.check('sk-test', WALLET);
  assert.equal(v.remainingTokens, 0);
  assert.equal(v.ok, false);
});

test('unknown key falls back to the free tier', () => {
  const db = new GatewayDb();
  const q = enforcer(db, { free: { dailyJobs: 7, dailyTokens: 70 } });
  const v = q.check('sk-not-a-key', WALLET);
  assert.equal(v.tier, 'free');
  assert.equal(v.limitJobs, 7);
});

test('issued keys carry their tier into the quota check', () => {
  const db = new GatewayDb();
  const keys = new ApiKeyStore(db);
  const proKey = keys.issue(WALLET, 'pro');
  const q = new QuotaEnforcer(new JobStore(db), keys, {
    free: { dailyJobs: 1, dailyTokens: 1 },
    pro: { dailyJobs: 1_000, dailyTokens: 1_000_000 },
  });
  const v = q.check(proKey, WALLET);
  assert.equal(v.tier, 'pro');
  assert.equal(v.limitJobs, 1_000);
});

// ── Prompt-abuse limits ────────────────────────────────────────────────────────

function req(over: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    model: 'mock-model',
    messages: [{ role: 'user', content: 'hello' }],
    ...over,
  } as ChatCompletionRequest;
}

test('prompt limits pass a normal request', () => {
  assert.equal(validatePromptLimits(req(), HARDENING_DEFAULTS), undefined);
});

test('too many messages is refused', () => {
  const h = resolveHardening({ maxMessages: 2 });
  const messages = [1, 2, 3].map(() => ({ role: 'user' as const, content: 'x' }));
  assert.match(validatePromptLimits(req({ messages }), h) ?? '', /too many messages/);
});

test('oversized prompt is refused', () => {
  const h = resolveHardening({ maxPromptChars: 10 });
  const messages = [{ role: 'user' as const, content: 'a'.repeat(11) }];
  assert.match(validatePromptLimits(req({ messages }), h) ?? '', /prompt too large/);
});

test('max_tokens above the cap is refused', () => {
  const h = resolveHardening({ maxTokensCap: 100 });
  assert.match(validatePromptLimits(req({ max_tokens: 101 }), h) ?? '', /max_tokens too large/);
});

test('banned patterns refuse without echoing the content', () => {
  const h = resolveHardening({ bannedPatterns: [/forbidden-thing/i] });
  const messages = [{ role: 'user' as const, content: 'please do the FORBIDDEN-THING now' }];
  const refusal = validatePromptLimits(req({ messages }), h);
  assert.equal(refusal, 'prompt contains disallowed content');
});
