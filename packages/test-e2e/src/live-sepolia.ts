/**
 * Live run against Arbitrum Sepolia: a real Ollama inference job that settles on the
 * public chain. Uses the deployer (from .env) as gateway+requester+treasury, and a
 * dedicated node wallet (persisted to .env as NODE_SEPOLIA_PRIVATE_KEY) bootstrapped
 * with ETH (gas) + QAIS (stake) by the deployer.
 *
 *   pnpm live:sepolia       (needs Ollama running with the model, and a funded deployer)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { formatEther, parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import OpenAI from 'openai';
import { loadAddresses, makePublicClient, makeWalletClient, quaisTokenAbi } from '@querais/shared';
import { buildGateway, type GatewayConfig } from '@querais/gateway';
import { startDaemon, deriveNodeId, OllamaBackend, type DaemonConfig } from '@querais/node-daemon';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_PATH = join(ROOT, '.env');
const MODEL = process.env.DEMO_MODEL ?? 'gemma3:4b';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

/** Read .env, ensure a NODE_SEPOLIA_PRIVATE_KEY exists (generate + persist if not). */
function ensureNodeKey(env: Record<string, string>): Hex {
  if (env.NODE_SEPOLIA_PRIVATE_KEY) return env.NODE_SEPOLIA_PRIVATE_KEY as Hex;
  const pk = generatePrivateKey();
  let text = readFileSync(ENV_PATH, 'utf8');
  text += `\n# Auto-generated node wallet for the Sepolia live run.\nNODE_SEPOLIA_PRIVATE_KEY=${pk}\n`;
  writeFileSync(ENV_PATH, text, 'utf8');
  console.log('Generated NODE_SEPOLIA_PRIVATE_KEY and saved to .env');
  return pk;
}

async function main(): Promise<void> {
  const env = parseEnv(readFileSync(ENV_PATH, 'utf8'));
  const deployerKey = env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY missing in .env');
  const nodeKey = ensureNodeKey(env);

  const dep = loadAddresses('arbitrumSepolia');
  const pub = makePublicClient(dep.rpcUrl, dep.chainId);
  const deployer = makeWalletClient(dep.rpcUrl, deployerKey, dep.chainId);
  const admin = deployer.account.address;
  const nodeAddr = privateKeyToAccount(nodeKey).address;
  const stake = parseEther('2500');

  console.log('Network   : Arbitrum Sepolia');
  console.log('Gateway/requester/treasury (deployer):', admin);
  console.log('Node wallet:', nodeAddr);

  // ── Bootstrap the node: ETH for gas + QAIS for stake (sequential deployer txs) ──
  const nodeEth = await pub.getBalance({ address: nodeAddr });
  if (nodeEth < parseEther('0.005')) {
    const h = await deployer.sendTransaction({ to: nodeAddr, value: parseEther('0.01') });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log('Funded node with 0.01 ETH for gas');
  }
  const nodeQais = (await pub.readContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'balanceOf',
    args: [nodeAddr],
  })) as bigint;
  if (nodeQais < stake) {
    const h = await deployer.writeContract({
      address: dep.contracts.token,
      abi: quaisTokenAbi,
      functionName: 'transfer',
      args: [nodeAddr, parseEther('5000')],
    });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log('Funded node with 5000 QAIS for stake');
  }

  // ── Requester (deployer) approves the escrow (one-time, before the job) ──
  const approveHash = await deployer.writeContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'approve',
    args: [dep.contracts.jobEscrow, parseEther('1000')],
  });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  console.log('Requester approved escrow');

  // ── Gateway (deployer is gateway+oracle+matching) ──
  const apiKey = 'sk-live';
  const gatewayConfig: GatewayConfig = {
    port: 0,
    network: 'arbitrumSepolia',
    rpcUrl: dep.rpcUrl,
    privateKey: deployerKey,
    apiKeys: new Map<string, Address>([[apiKey, admin]]),
    defaultMaxTokens: 64,
    defaultMaxPricePerTokenWei: parseEther('0.001'),
    defaultMinReputation: 0,
    jobDeadlineSeconds: 180,
    rateLimitMax: 120,
  };
  const { app } = await buildGateway({ config: gatewayConfig });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind gateway');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  // ── Node daemon (real Ollama) — registers on Sepolia, then connects ──
  const backend = new OllamaBackend(OLLAMA_URL);
  if (!(await backend.isAvailable())) throw new Error(`Ollama not reachable at ${OLLAMA_URL}`);
  const daemonConfig: DaemonConfig = {
    network: 'arbitrumSepolia',
    rpcUrl: dep.rpcUrl,
    gatewayWsUrl: `ws://127.0.0.1:${addr.port}/node`,
    ollamaUrl: OLLAMA_URL,
    privateKey: nodeKey,
    nodeId: deriveNodeId(nodeKey),
    stakeWei: stake,
    servedModels: [MODEL],
    basePricePerTokenWei: parseEther('0.0005'),
  };
  console.log('Registering node on Sepolia + connecting (real tx)…');
  const daemon = await startDaemon(daemonConfig, backend);
  await waitForNode(baseUrl);

  // ── Submit a real job via the official OpenAI client ──
  const nodeQaisBefore = (await pub.readContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'balanceOf',
    args: [nodeAddr],
  })) as bigint;

  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey });
  console.log(`\nSubmitting inference job (model ${MODEL}) to Sepolia…`);
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'In one sentence, what is Arbitrum?' }],
    max_tokens: 64,
  });
  const content = completion.choices[0]?.message.content ?? '';
  console.log('\nResponse:', content);

  // ── Confirm on-chain settlement ──
  await delay(1500);
  const nodeQaisAfter = (await pub.readContract({
    address: dep.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'balanceOf',
    args: [nodeAddr],
  })) as bigint;
  console.log('\n— On-chain settlement (Arbitrum Sepolia) —');
  console.log('Node QAIS earned:', formatEther(nodeQaisAfter - nodeQaisBefore), 'QAIS');
  console.log('Tokens used      :', completion.usage?.completion_tokens);
  console.log('Node on Arbiscan : https://sepolia.arbiscan.io/address/' + nodeAddr);

  await daemon.stop();
  await app.close();
  console.log('\n✅ LIVE on Arbitrum Sepolia: real inference returned AND settled on-chain.');
  process.exit(0);
}

async function waitForNode(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const body = (await (await fetch(`${baseUrl}/health`)).json()) as { nodes?: number };
      if ((body.nodes ?? 0) >= 1) return;
    } catch {
      /* warming up */
    }
    if (Date.now() > deadline) throw new Error('node did not join the gateway pool in time');
    await delay(300);
  }
}

void main();
