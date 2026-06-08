import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

/** Walk up to the monorepo root (the dir holding pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function waitForRpc(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      const body = (await res.json()) as { result?: string };
      if (body.result) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('chain RPC did not become ready');
    await delay(300);
  }
}

function runOnce(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', args, { cwd, shell: true, stdio: 'ignore' });
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} exited ${code}`)),
    );
    proc.on('error', reject);
  });
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      });
      k.on('exit', () => resolve());
      k.on('error', () => resolve());
    } else {
      try {
        process.kill(-pid);
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

/** Best-effort: kill anything already listening on 8545 so we never reuse a stale,
 * clock-drifted node (Hardhat block timestamps drift ahead under bursty load). */
function freePort8545(): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set<string>();
      for (const line of out.split(/\r?\n/)) {
        if (line.includes(':8545') && /LISTENING/i.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== '0') pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync('fuser -k 8545/tcp', { stdio: 'ignore' });
    }
  } catch {
    /* best effort */
  }
}

export interface ChainHandle {
  stop: () => Promise<void>;
}

/** Start a fresh local Hardhat node and deploy the contracts to it. */
export async function startChainAndDeploy(): Promise<ChainHandle> {
  const root = repoRoot();
  freePort8545();
  await delay(500);
  const node = spawn('pnpm', ['--filter', '@querais/contracts', 'chain'], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
  });
  await waitForRpc('http://127.0.0.1:8545', 40_000);
  await runOnce(root, ['--filter', '@querais/contracts', 'deploy:local']);
  return {
    stop: async () => {
      if (node.pid) await killTree(node.pid);
    },
  };
}
