import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL } from '../lib/site';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <div className="wrap notfound">
      <div className="code404">404</div>
      <h1>Lost in the mesh</h1>
      <p className="muted" style={{ maxWidth: 460, margin: '0 auto 24px' }}>
        That page isn&apos;t on the network. Here&apos;s the way back:
      </p>
      <div className="cta-row">
        <Link className="btn" href="/">
          Home
        </Link>
        <Link className="btn ghost" href="/docs/">
          Docs
        </Link>
        <Link className="btn ghost" href="/for-developers/">
          For developers
        </Link>
        <a className="btn ghost" href={APP_URL}>
          Open app →
        </a>
      </div>
    </div>
  );
}
