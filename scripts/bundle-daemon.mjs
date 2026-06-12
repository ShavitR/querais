/**
 * Bundle the node daemon into a single runnable release artifact (Slice 9.11).
 *
 * esbuild inlines every dependency into one ESM file (node:* builtins stay
 * external — they ship with Node), then a staging directory is assembled:
 *
 *   release/querais-node-<version>/
 *     bundle/daemon.mjs        ← the whole daemon, no pnpm / no build needed
 *     deployments/…            ← real-network manifests (loadAddresses reads
 *                                bundle/../deployments/addresses.<net>.json)
 *     run-node.ps1 / .sh       ← launchers (Node >= 22.13 check, .env bootstrap)
 *     .env.example             ← operator config template
 *     INSTALL.md               ← docs/NODE_RELEASE_INSTALL.md
 *
 * …and archived as release/querais-node-<version>.tar.gz + release/SHA256SUMS.
 * Operators need only Node >= 22.13 and Ollama (the floor CI already enforces).
 *
 * Usage: node scripts/bundle-daemon.mjs [--version v0.2.0] [--no-archive]
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const versionArg = process.argv.indexOf('--version');
const pkg = JSON.parse(readFileSync(join(root, 'packages/node-daemon/package.json'), 'utf8'));
const version = versionArg !== -1 ? process.argv[versionArg + 1] : `v${pkg.version}`;
const archive = !process.argv.includes('--no-archive');

const releaseDir = join(root, 'release');
const stage = join(releaseDir, `querais-node-${version}`);
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(join(stage, 'bundle'), { recursive: true });
mkdirSync(join(stage, 'deployments'), { recursive: true });

// 1. The bundle. ESM output keeps import.meta.url semantics (the daemon derives
// its .env walk and the deployments dir from it). The createRequire banner lets
// inlined CJS deps (pino, ws) require() externals; ws's optional native addons
// (bufferutil / utf-8-validate) stay external — ws falls back to JS without them.
await build({
  entryPoints: [join(root, 'packages/node-daemon/src/main.ts')],
  outfile: join(stage, 'bundle', 'daemon.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __qCreateRequire } from 'node:module';\nconst require = __qCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// 2. Real-network deployment manifests (NOT the ephemeral localhost one — the
// release smoke injects that itself when testing against a local chain).
const deployments = join(root, 'packages/contracts/deployments');
for (const f of readdirSync(deployments)) {
  if (f.startsWith('addresses.') && !f.includes('localhost')) {
    copyFileSync(join(deployments, f), join(stage, 'deployments', f));
  }
}

// 3. Launchers, operator config template, install doc.
copyFileSync(join(root, 'scripts/release/run-node.ps1'), join(stage, 'run-node.ps1'));
copyFileSync(join(root, 'scripts/release/run-node.sh'), join(stage, 'run-node.sh'));
copyFileSync(join(root, 'scripts/release/env.example'), join(stage, '.env.example'));
copyFileSync(join(root, 'docs/NODE_RELEASE_INSTALL.md'), join(stage, 'INSTALL.md'));

console.log(`staged ${stage}`);
if (!archive) process.exit(0);

// 4. Archive (tar.gz — Windows 10+ ships tar.exe, so one format serves every OS)
// and SHA256SUMS covering every archive in release/.
const tarball = `querais-node-${version}.tar.gz`;
execFileSync('tar', [
  '-czf',
  join(releaseDir, tarball),
  '-C',
  releaseDir,
  `querais-node-${version}`,
]);
const sums = readdirSync(releaseDir)
  .filter((f) => f.endsWith('.tar.gz'))
  .map((f) => {
    const digest = createHash('sha256')
      .update(readFileSync(join(releaseDir, f)))
      .digest('hex');
    return `${digest}  ${f}`;
  })
  .join('\n');
writeFileSync(join(releaseDir, 'SHA256SUMS'), sums + '\n');
console.log(`archived release/${tarball}`);
console.log(`SHA256SUMS:\n${sums}`);
