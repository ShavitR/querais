import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { buildGateway } from './server.js';

function loadDotenv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadEnv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadEnv();
}

/**
 * Max time to drain on SIGTERM before forcing exit. `app.close()` runs the onClose hook
 * that flushes pending debits (money owed to nodes) in one batchSettle, so this must
 * comfortably exceed worst-case flush gas latency — size the platform's stop grace
 * window above it too (runbook §9). A flush that overruns is logged, not lost: the
 * debits are durable and the next instance's interval flush settles them.
 */
const SHUTDOWN_GRACE_MS = Number(process.env.GATEWAY_SHUTDOWN_GRACE_MS ?? '25000');

async function main(): Promise<void> {
  loadDotenv();
  const config = loadConfig();
  const { app, deps } = await buildGateway({ config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  deps.logger.info({ port: config.port }, 'QueraIS gateway listening');

  // Graceful shutdown: a container platform sends SIGTERM, then SIGKILLs after its grace
  // window. Drain in between — app.close() flushes pending debits and releases SQLite.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // a second signal during drain must not re-enter
    shuttingDown = true;
    deps.logger.info({ signal }, 'shutdown signal — draining (flush pending debits)…');
    const forceTimer = setTimeout(() => {
      deps.logger.error({ graceMs: SHUTDOWN_GRACE_MS }, 'drain exceeded grace — forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref();
    app
      .close()
      .then(() => {
        deps.logger.info('drain complete — exiting cleanly');
        process.exit(0);
      })
      .catch((err: unknown) => {
        deps.logger.error({ err }, 'error during drain');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
