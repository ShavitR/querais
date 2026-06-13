import type { Metadata } from 'next';
import { APP_URL } from '../../../lib/site';

export const metadata: Metadata = {
  title: 'Quickstart',
  description: 'Call the QueraIS API in 2 minutes, or run a GPU node and earn $QAIS in ~5 minutes.',
};

const apiSnippet = `from openai import OpenAI

client = OpenAI(base_url="https://gateway.querais.xyz/v1", api_key="sk-...")
stream = client.chat.completions.create(
    model="llama3.2",
    messages=[{"role": "user", "content": "Explain Arbitrum in one sentence."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

const nodeSnippet = `# 1. pull a model
ollama pull llama3.2

# 2. download the latest node release from GitHub, then:
./run-node.sh        # macOS / Linux   (run-node.ps1 on Windows)`;

export default function Quickstart() {
  return (
    <div className="wrap" style={{ paddingTop: 40, maxWidth: 820 }}>
      <h1>Quickstart</h1>

      <h2>Use the API (2 min)</h2>
      <p className="muted">
        Point any OpenAI-compatible client at the gateway. During the beta the operator issues keys.
      </p>
      <pre>
        <code>{apiSnippet}</code>
      </pre>
      <p>
        Prefer a typed client? <code>pip install querais</code> or <code>npm i @querais/sdk</code> —
        both wrap the official OpenAI client and add sessions, <code>nodes</code>, and{' '}
        <code>stats</code>.
      </p>

      <h2>Run a node (~5 min)</h2>
      <p className="muted">You need Node 22.13+ and Ollama with a model pulled.</p>
      <pre>
        <code>{nodeSnippet}</code>
      </pre>
      <p>
        The node auto-claims $QAIS from the faucet, stakes, registers on-chain, and starts serving.
        Watch your earnings and reputation in the dashboard&apos;s operator console.
      </p>

      <h2>Pre-fund credit (skip per-call gas)</h2>
      <p className="muted">
        In the dashboard&apos;s <b>Credit</b> page: deposit $QAIS, sign one EIP-712 spending cap,
        then fire as many calls as you like — they batch-settle in a single transaction.
      </p>
      <p>
        <a className="btn" href={APP_URL}>
          Open the dashboard →
        </a>
      </p>
    </div>
  );
}
