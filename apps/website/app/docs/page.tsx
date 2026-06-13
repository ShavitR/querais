import type { Metadata } from 'next';
import Link from 'next/link';
import { REPO_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Docs',
  alternates: { canonical: '/docs/' },
  description:
    'QueraIS documentation — quickstart, how it works, SDKs, and the full project README.',
};

export default function Docs() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h1>Docs</h1>
      <div className="grid2" style={{ marginTop: 20 }}>
        <div className="card">
          <h3>
            <Link href="/docs/quickstart/">Quickstart →</Link>
          </h3>
          <p>Call the API in 2 minutes, or run a node in ~5.</p>
        </div>
        <div className="card">
          <h3>
            <Link href="/how-it-works/">How it works →</Link>
          </h3>
          <p>The job lifecycle from request to on-chain settlement.</p>
        </div>
        <div className="card">
          <h3>
            <a href={`${REPO_URL}#readme`}>Full README →</a>
          </h3>
          <p>Complete project docs, contracts, and runbooks on GitHub.</p>
        </div>
        <div className="card">
          <h3>
            <a href="https://www.npmjs.com/package/@querais/sdk">SDKs →</a>
          </h3>
          <p>
            TypeScript (npm <code>@querais/sdk</code>) and Python (PyPI <code>querais</code>) — both
            wrap the official OpenAI client.
          </p>
        </div>
      </div>
    </div>
  );
}
