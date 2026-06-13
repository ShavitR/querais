import Link from 'next/link';
import { APP_URL, REPO_URL, STATUS_URL } from '../lib/site';
import { QueraisLogo } from './QueraisLogo';

export function Footer() {
  return (
    <footer className="site">
      <div className="wrap">
        <div className="cols">
          <div className="col brandcol">
            <QueraisLogo size={22} />
            <p>Decentralized AI inference — BitTorrent for GPU compute. Testnet, no real value.</p>
          </div>

          <div className="col">
            <h4>Product</h4>
            <Link href="/how-it-works/">How it works</Link>
            <Link href="/pricing/">Pricing</Link>
            <Link href="/tokenomics/">Tokenomics</Link>
            <Link href="/security/">Security</Link>
            <Link href="/architecture/">Architecture</Link>
          </div>

          <div className="col">
            <h4>Developers</h4>
            <Link href="/for-developers/">For developers</Link>
            <Link href="/docs/">Docs</Link>
            <Link href="/docs/quickstart/">Quickstart</Link>
            <Link href="/docs/api/">API reference</Link>
            <a href={REPO_URL}>GitHub</a>
          </div>

          <div className="col">
            <h4>Network</h4>
            <Link href="/for-node-operators/">Run a node</Link>
            <Link href="/roadmap/">Roadmap</Link>
            <a href={APP_URL}>Open app</a>
            <a href={STATUS_URL}>Status</a>
            <Link href="/faq/">FAQ</Link>
          </div>

          <div className="col">
            <h4>Legal</h4>
            <Link href="/terms/">Terms</Link>
            <Link href="/privacy/">Privacy</Link>
          </div>
        </div>

        <div className="legal">
          <span className="muted">QueraIS · testnet, no real value</span>
        </div>
      </div>
    </footer>
  );
}
