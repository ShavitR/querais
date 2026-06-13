import type { Metadata } from 'next';
import Link from 'next/link';
import { Calculator } from '../../components/Calculator';
import { CodeBlock } from '../../components/CodeBlock';
import { SeeAlso } from '../../components/SeeAlso';
import { highlight } from '../../lib/highlight';
import { APP_URL, REPO_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'For developers',
  alternates: { canonical: '/for-developers/' },
  description:
    'QueraIS is an OpenAI-compatible inference API. Change one line — the base URL — and your existing OpenAI code runs on a decentralized GPU network. Official @querais/sdk (npm) and querais (PyPI).',
};

const ENDPOINTS: { method: string; path: string; purpose: string }[] = [
  {
    method: 'POST',
    path: '/v1/chat/completions',
    purpose: 'Inference — streaming & buffered (OpenAI-compatible)',
  },
  { method: 'GET', path: '/v1/models', purpose: 'List models available across the network' },
  { method: 'GET', path: '/v1/nodes', purpose: 'Active nodes: wallet, reputation, models, prices' },
  { method: 'GET', path: '/v1/stats', purpose: 'Network totals — nodes, jobs, tokens, treasury' },
  {
    method: 'GET',
    path: '/v1/network/economics',
    purpose: 'Supply, burned, treasury, staker pool',
  },
  {
    method: 'GET',
    path: '/v1/credit/info',
    purpose: 'Contract data needed to sign a spending cap',
  },
  {
    method: 'POST',
    path: '/v1/sessions',
    purpose: 'Register an EIP-712 cap to enable batch settlement',
  },
];

const openaiPy = `from openai import OpenAI

# The only change from OpenAI: the base_url.
client = OpenAI(
    base_url="https://gateway.querais.xyz/v1",
    api_key="sk-...",
)

resp = client.chat.completions.create(
    model="gemma3:4b",
    messages=[{"role": "user", "content": "Explain Arbitrum in one sentence."}],
)
print(resp.choices[0].message.content)`;

const openaiTs = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://gateway.querais.xyz/v1', // <- the only change
  apiKey: 'sk-...',
});

const r = await client.chat.completions.create({
  model: 'gemma3:4b',
  messages: [{ role: 'user', content: 'Explain Arbitrum in one sentence.' }],
});
console.log(r.choices[0].message.content);`;

const sdkTs = `import { QueraisClient } from '@querais/sdk';

// baseUrl defaults to https://gateway.querais.xyz
const client = new QueraisClient({ apiKey: 'sk-querais-...' });

const r = await client.chat([{ role: 'user', content: 'Explain Arbitrum in one sentence.' }], {
  model: 'gemma3:4b',
  maxPricePer1kTokens: 0.5, // cap what you pay
  minReputation: 0.7, // floor node quality
});
console.log(r.content, r.usage);`;

const sdkPy = `from querais import QueraisClient

client = QueraisClient("https://gateway.querais.xyz", api_key="sk-...")

result = client.chat(
    [{"role": "user", "content": "Explain Arbitrum in one sentence."}],
    model="llama3.2",
    max_price_per_1k_tokens=0.5,  # cap what you pay
    min_reputation=0.7,           # floor node quality
)
print(result.content)`;

const curl = `curl https://gateway.querais.xyz/v1/chat/completions \\
  -H "Authorization: Bearer $QUERAIS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemma3:4b",
    "messages": [{"role": "user", "content": "Explain Arbitrum in one sentence."}]
  }'`;

export default async function ForDevelopers() {
  const [bOpenaiPy, bOpenaiTs, bCurl, bNpm, bSdkTs, bPip, bSdkPy] = await Promise.all([
    highlight(openaiPy, 'python', 'python · openai'),
    highlight(openaiTs, 'typescript', 'typescript · openai'),
    highlight(curl, 'bash', 'curl'),
    highlight('npm install @querais/sdk', 'bash', 'npm'),
    highlight(sdkTs, 'typescript', 'typescript'),
    highlight('pip install querais', 'bash', 'pip'),
    highlight(sdkPy, 'python', 'python'),
  ]);

  return (
    <div className="wrap page-head">
      <p className="kicker">Developers</p>
      <h1>One endpoint. Every model. OpenAI-compatible.</h1>
      <p className="lede">
        QueraIS speaks the OpenAI chat-completions protocol, so your existing code, SDKs, and tools
        just work. Point them at the gateway and your prompts run on an open market of GPU nodes —
        usually cheaper, with no single provider to depend on.
      </p>

      <div className="cta-row" style={{ justifyContent: 'flex-start', marginTop: 24 }}>
        <a className="btn" href={APP_URL}>
          Open app →
        </a>
        <Link className="btn ghost" href="/docs/quickstart/">
          Quickstart
        </Link>
        <a className="btn ghost" href={REPO_URL}>
          GitHub
        </a>
      </div>

      <section className="block" style={{ borderTop: 'none', paddingTop: 32 }}>
        <h2>Migrate in one line</h2>
        <p className="muted">
          Already using the <code>openai</code> package? Swap the base URL — nothing else changes.
        </p>
        <CodeBlock block={bOpenaiPy} />
        <CodeBlock block={bOpenaiTs} />
        <CodeBlock block={bCurl} />
      </section>

      <section className="block">
        <h2>Or use the QueraIS SDK</h2>
        <p className="muted">
          Thin wrappers that add the marketplace surface on top of the OpenAI protocol — routing
          options, node/stats introspection, and batched-settlement sessions.
        </p>

        <h3 style={{ marginTop: 24 }}>TypeScript · @querais/sdk</h3>
        <CodeBlock block={bNpm} />
        <CodeBlock block={bSdkTs} />

        <h3 style={{ marginTop: 24 }}>Python · querais</h3>
        <CodeBlock block={bPip} />
        <CodeBlock block={bSdkPy} />
        <p className="muted" style={{ fontSize: 14 }}>
          Both SDKs also stream (<code>chatStream</code> / <code>chat_stream</code>) and expose{' '}
          <code>models()</code>, <code>nodes()</code>, and <code>stats()</code>. The Python package
          ships official LangChain and LlamaIndex adapters.
        </p>
      </section>

      <section className="block">
        <h2>More than a clone — route the market</h2>
        <div className="grid3">
          <div className="card">
            <h3>Price ceilings</h3>
            <p>
              <code>maxPricePer1kTokens</code> caps what any node can charge for your job.
            </p>
          </div>
          <div className="card">
            <h3>Quality floors</h3>
            <p>
              <code>minReputation</code> routes only to nodes above a reputation threshold.
            </p>
          </div>
          <div className="card">
            <h3>No lock-in</h3>
            <p>Open protocol, open contracts. Leave whenever — it&apos;s just the OpenAI API.</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>Estimate a request</h2>
        <p className="muted">
          Nodes set their own per-token price; you pay what the matched node quotes, plus the flat
          5% protocol fee.
        </p>
        <Calculator />
      </section>

      <section className="block">
        <h2>API surface</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="num">{e.method}</td>
                  <td>
                    <code>{e.path}</code>
                  </td>
                  <td className="muted">{e.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>Auth &amp; billing</h2>
        <div className="grid2">
          <div className="card">
            <h3>API key</h3>
            <p>
              Pass <code>Authorization: Bearer sk-…</code>. Keys are issued by the gateway operator
              during beta — ask in the project channel or open a GitHub issue.
            </p>
          </div>
          <div className="card">
            <h3>Pre-funded credit</h3>
            <p>
              Deposit $QAIS into the CreditAccount contract once, sign one EIP-712 spending cap,
              then fire unlimited jobs — settled in batches, no wallet pop-up per call.
            </p>
          </div>
          <div className="card">
            <h3>Capped exposure</h3>
            <p>The signed cap bounds the most the gateway can ever spend. Revoke in one tx.</p>
          </div>
          <div className="card">
            <h3>95 / 5 settlement</h3>
            <p>95% of each job goes to the serving node, 5% to the protocol — enforced on-chain.</p>
          </div>
        </div>
      </section>

      <SeeAlso
        links={[
          {
            href: '/docs/quickstart/',
            title: 'Quickstart',
            desc: 'Call the API in two minutes, end to end.',
          },
          {
            href: '/pricing/',
            title: 'Pricing',
            desc: 'Per-token pricing and the flat 5% fee.',
          },
          {
            href: '/security/',
            title: 'Security',
            desc: 'How reputation and verification keep results honest.',
          },
        ]}
      />
    </div>
  );
}
