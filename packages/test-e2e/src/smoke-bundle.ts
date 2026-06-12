/**
 * Release-bundle smoke (`pnpm smoke:bundle`, Slice 9.11).
 *
 * Proves the esbuild-bundled daemon — the exact artifact operators download — can
 * serve a real job: fresh Hardhat chain + contracts, gateway in gateway-only mode,
 * then `node release/querais-node-<v>/bundle/daemon.mjs` as a SEPARATE PROCESS
 * (DAEMON_BACKEND=mock so no Ollama is needed), wait for it to register + join the
 * pool, run one chat completion through it, and assert a 200 with content.
 *
 * Run `node scripts/bundle-daemon.mjs` first (release.yml does both in order).
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startChainAndDeploy, repoRoot } from './chain.js';
import { startHarness, API_KEY, KEYS } from './harness.js';

async function main(): Promise<void> {
  const root = repoRoot();
  const releaseDir = join(root, 'release');
  const stage = existsSync(releaseDir)
    ? readdirSync(releaseDir).find((f) => f.startsWith('querais-node-') && !f.endsWith('.tar.gz'))
    : undefined;
  if (!stage) {
    throw new Error('no staged bundle in release/ — run `node scripts/bundle-daemon.mjs` first');
  }
  const stageDir = join(releaseDir, stage);
  const daemonPath = join(stageDir, 'bundle', 'daemon.mjs');
  console.log(`⛓  smoke target: ${daemonPath}`);

  console.log('⛓  starting local chain + deploying contracts…');
  const chain = await startChainAndDeploy();
  let ok = false;
  let daemon: ChildProcess | undefined;
  try {
    // The bundle resolves deployments/ next to bundle/ — inject the manifest the
    // local deploy just wrote (release archives carry only real-network manifests).
    mkdirSync(join(stageDir, 'deployments'), { recursive: true });
    copyFileSync(
      join(root, 'packages/contracts/deployments/addresses.localhost.json'),
      join(stageDir, 'deployments', 'addresses.localhost.json'),
    );

    console.log('▶  gateway up (gateway-only), spawning the bundled daemon…');
    const h = await startHarness({ noDaemon: true });
    try {
      daemon = spawn(process.execPath, [daemonPath], {
        env: {
          ...process.env,
          NETWORK: 'localhost',
          RPC_URL: h.deployment.rpcUrl,
          GATEWAY_WS_URL: `${h.baseUrl.replace('http://', 'ws://')}/node`,
          NODE_PRIVATE_KEY: KEYS.node, // well-known Hardhat dev key, local only
          DAEMON_MODELS: 'mock-model',
          DAEMON_BACKEND: 'mock', // no Ollama in CI — deterministic mock inference
          DAEMON_AUTO_FAUCET: 'false', // the dev account is pre-funded by the deploy
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      });

      const deadline = Date.now() + 30_000;
      for (;;) {
        const health = (await (await fetch(`${h.baseUrl}/health`)).json()) as { nodes?: number };
        if ((health.nodes ?? 0) >= 1) break;
        if (daemon.exitCode !== null) {
          throw new Error(`bundled daemon exited early (code ${daemon.exitCode})`);
        }
        assert.ok(Date.now() < deadline, 'timed out waiting for the bundled daemon to join');
        await delay(300);
      }
      console.log('▶  bundled daemon joined the pool — running one job through it…');

      const res = await fetch(`${h.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'smoke test: is anyone serving?' }],
          max_tokens: 32,
        }),
      });
      assert.equal(res.status, 200, `chat through the bundled daemon (got ${res.status})`);
      const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      const content = body.choices[0]?.message.content ?? '';
      assert.ok(content.length > 0, 'the completion has content');
      console.log(`✅ bundled daemon served a real job: "${content.slice(0, 60)}"`);
      ok = true;
    } finally {
      if (daemon?.pid && daemon.exitCode === null) daemon.kill();
      await h.stop();
    }
  } catch (err) {
    console.error('\n❌ BUNDLE SMOKE FAILED');
    console.error(err);
  } finally {
    await chain.stop();
  }
  process.exit(ok ? 0 : 1);
}

void main();
