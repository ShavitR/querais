/**
 * `pnpm demo` — human-visible end-to-end run with REAL local inference (Ollama).
 *
 * Spins up the chain + contracts, starts the gateway + a node daemon backed by
 * Ollama, streams a real completion to the console, prints the protocol fee accrued
 * on-chain, and leaves the dashboard running so you can open it in a browser.
 */
import { formatEther } from 'viem';
import { makePublicClient, quaisTokenAbi } from '@querais/shared';
import { OllamaBackend } from '@querais/node-daemon';
import { startChainAndDeploy } from './chain.js';
import { startHarness, API_KEY } from './harness.js';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.DEMO_MODEL ?? 'gemma3:4b';
const PROMPT =
  process.env.DEMO_PROMPT ??
  'In one short sentence, what is a decentralized AI compute marketplace?';

async function streamPrompt(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
      stream: true,
      max_tokens: 200,
    }),
  });
  if (!res.ok || !res.body) {
    console.error(`request failed: HTTP ${res.status} ${await res.text()}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const m = line.replace(/^data: /, '').trim();
      if (!m || m === '[DONE]') continue;
      try {
        const j = JSON.parse(m) as { choices?: Array<{ delta?: { content?: string } }> };
        const d = j.choices?.[0]?.delta?.content;
        if (d) process.stdout.write(d);
      } catch {
        /* skip non-JSON frames */
      }
    }
  }
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  console.log('⛓  starting local chain + deploying contracts…');
  const chain = await startChainAndDeploy();

  const backend = new OllamaBackend(OLLAMA_URL);
  if (!(await backend.isAvailable())) {
    console.error(`Ollama is not reachable at ${OLLAMA_URL}. Start it and pull a model.`);
    await chain.stop();
    process.exit(1);
  }
  const models = await backend.listModels();
  if (!models.includes(MODEL)) {
    console.error(`Model "${MODEL}" not pulled. Available: ${models.join(', ') || 'none'}`);
    await chain.stop();
    process.exit(1);
  }

  console.log(`🧠 starting gateway + node (Ollama: ${MODEL})…`);
  const h = await startHarness({ backend, model: MODEL });
  console.log(`\n🌐 Dashboard:  ${h.baseUrl}   ← open in a browser\n`);

  console.log(`Prompt:   ${PROMPT}`);
  process.stdout.write('Response: ');
  await streamPrompt(h.baseUrl);

  const pub = makePublicClient(h.deployment.rpcUrl);
  const treasuryBal = await pub.readContract({
    address: h.deployment.contracts.token,
    abi: quaisTokenAbi,
    functionName: 'balanceOf',
    args: [h.deployment.treasury],
  });
  console.log(`\n💰 Protocol fees accrued in treasury: ${formatEther(treasuryBal)} QAIS`);
  console.log(`\nDashboard still live at ${h.baseUrl} — press Ctrl+C to stop.\n`);

  const shutdown = async () => {
    console.log('\nshutting down…');
    await h.stop();
    await chain.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
}

void main();
