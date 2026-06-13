import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '../../../components/Breadcrumb';
import { CodeBlock } from '../../../components/CodeBlock';
import { SeeAlso } from '../../../components/SeeAlso';
import { highlight } from '../../../lib/highlight';
import { APP_URL } from '../../../lib/site';

export const metadata: Metadata = {
  title: 'API reference',
  alternates: { canonical: '/docs/api/' },
  description:
    'QueraIS HTTP API reference — OpenAI-compatible /v1/chat/completions and /v1/models, plus marketplace and credit/session endpoints. Bearer key or wallet-session auth.',
};

type Row = { method: string; path: string; auth: string; purpose: string };

const OPENAI: Row[] = [
  {
    method: 'POST',
    path: '/v1/chat/completions',
    auth: 'key',
    purpose: 'Chat inference — streaming (SSE) & buffered',
  },
  {
    method: 'GET',
    path: '/v1/models',
    auth: 'key',
    purpose: 'Models available across the network',
  },
];
const MARKET: Row[] = [
  {
    method: 'GET',
    path: '/v1/nodes',
    auth: 'public',
    purpose: 'Active nodes: wallet, reputation, models, prices',
  },
  {
    method: 'GET',
    path: '/v1/stats',
    auth: 'public',
    purpose: 'Network totals — nodes, jobs, tokens, treasury',
  },
  {
    method: 'GET',
    path: '/v1/network/economics',
    auth: 'public',
    purpose: 'Supply, burned, treasury, staker pool',
  },
  {
    method: 'GET',
    path: '/v1/network/recent-jobs',
    auth: 'public',
    purpose: 'Recent-jobs ticker (hashes + models only)',
  },
  { method: 'GET', path: '/v1/jobs', auth: 'key/session', purpose: 'Your recent jobs' },
  {
    method: 'GET',
    path: '/v1/usage',
    auth: 'key/session',
    purpose: 'Your jobs, tokens, and $QAIS spent',
  },
];
const CREDIT: Row[] = [
  {
    method: 'GET',
    path: '/v1/credit/info',
    auth: 'public',
    purpose: 'Contract data needed to sign a spending cap',
  },
  {
    method: 'GET',
    path: '/v1/sessions',
    auth: 'key/session',
    purpose: 'Live session: cap, spend, balance, headroom',
  },
  {
    method: 'POST',
    path: '/v1/sessions',
    auth: 'key/session',
    purpose: 'Register an EIP-712 cap for batched settlement',
  },
  {
    method: 'GET',
    path: '/v1/models/manifest',
    auth: 'public',
    purpose: 'Signed model-digest manifest (404 if unpinned)',
  },
];

const reqExample = `curl https://gateway.querais.xyz/v1/chat/completions \\
  -H "Authorization: Bearer $QUERAIS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemma3:4b",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'`;

const resExample = `{
  "id": "chatcmpl-9f2c…",
  "object": "chat.completion",
  "model": "gemma3:4b",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 9, "completion_tokens": 7, "total_tokens": 16 }
}`;

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
      <h3 style={{ marginTop: 28 }}>{title}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Auth</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path + r.method}>
                <td className="num">{r.method}</td>
                <td>
                  <code>{r.path}</code>
                </td>
                <td className="muted">{r.auth}</td>
                <td className="muted">{r.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function ApiReference() {
  const [bReq, bRes] = await Promise.all([
    highlight(reqExample, 'bash', 'request'),
    highlight(resExample, 'json', 'response'),
  ]);

  return (
    <div className="wrap page-head">
      <Breadcrumb
        items={[
          { name: 'Docs', path: '/docs/' },
          { name: 'API', path: '/docs/api/' },
        ]}
      />
      <p className="kicker">Reference</p>
      <h1>API reference</h1>
      <p className="lede">
        The gateway speaks the OpenAI chat-completions protocol and adds a small marketplace surface
        on top. Base URL: <code>https://gateway.querais.xyz</code>. See{' '}
        <Link href="/for-developers/">For developers</Link> for SDK quickstarts.
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <h2>Authentication</h2>
        <p className="muted">
          Most write endpoints take an API key as <code>Authorization: Bearer sk-…</code>. The web
          dashboard instead uses a wallet session (EIP-4361 “Sign-In with Ethereum”) carried in a
          cookie; where both are present, the bearer key wins. Public endpoints need no auth.
        </p>
      </section>

      <section className="block">
        <h2>Example — chat completion</h2>
        <CodeBlock block={bReq} />
        <CodeBlock block={bRes} />
        <p className="muted" style={{ fontSize: 14 }}>
          The response mirrors OpenAI’s shape. Set <code>"stream": true</code> for token-by-token
          Server-Sent Events; in-band errors arrive as an SSE frame with an <code>error</code> field
          (HTTP 200), so check for it while streaming.
        </p>
      </section>

      <section className="block">
        <h2>Endpoints</h2>
        <Table title="OpenAI-compatible" rows={OPENAI} />
        <Table title="Marketplace" rows={MARKET} />
        <Table title="Credit & sessions" rows={CREDIT} />
      </section>

      <div className="cta-row" style={{ justifyContent: 'flex-start' }}>
        <a className="btn" href={APP_URL}>
          Open app →
        </a>
        <Link className="btn ghost" href="/docs/quickstart/">
          Quickstart
        </Link>
      </div>

      <SeeAlso
        links={[
          {
            href: '/for-developers/',
            title: 'For developers',
            desc: 'OpenAI drop-in, SDKs, and routing extensions.',
          },
          {
            href: '/docs/quickstart/',
            title: 'Quickstart',
            desc: 'Your first call in two minutes.',
          },
          {
            href: '/architecture/',
            title: 'Architecture',
            desc: 'What happens to a request after you send it.',
          },
        ]}
      />
    </div>
  );
}
