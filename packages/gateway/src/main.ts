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

async function main(): Promise<void> {
  loadDotenv();
  const config = loadConfig();
  const { app, deps } = await buildGateway({ config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  deps.logger.info({ port: config.port }, 'QueraIS gateway listening');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
