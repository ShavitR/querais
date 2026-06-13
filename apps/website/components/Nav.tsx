import Link from 'next/link';
import { APP_URL, REPO_URL } from '../lib/site';
import { QueraisLogo } from './QueraisLogo';

export function Nav() {
  return (
    <nav className="nav">
      <div className="wrap inner">
        <Link href="/" className="brand" aria-label="QueraIS home">
          <QueraisLogo size={22} />
        </Link>
        <Link href="/how-it-works/">How it works</Link>
        <Link href="/pricing/">Pricing</Link>
        <Link href="/docs/">Docs</Link>
        <Link href="/faq/">FAQ</Link>
        <span className="spacer" />
        <a href={REPO_URL}>GitHub</a>
        <a className="btn" href={APP_URL}>
          Open app →
        </a>
      </div>
    </nav>
  );
}
