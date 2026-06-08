import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { startDaemon } from './daemon.js';

/** Load the nearest .env walking up from this file (the monorepo root holds it). */
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

loadDotenv();
startDaemon(loadConfig()).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
