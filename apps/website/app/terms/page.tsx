import type { Metadata } from 'next';
import { renderLegal } from '../../lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service',
  alternates: { canonical: '/terms/' },
  description:
    'QueraIS Terms of Service — an experimental, testnet-only decentralized AI inference marketplace. Prompts are served by independent operators; $QAIS is a valueless test token.',
};

export default function Terms() {
  const doc = renderLegal('TERMS.md');
  return (
    <div className="wrap page-head">
      <p className="kicker">Legal</p>
      <h1>Terms of Service</h1>
      {doc.updated && (
        <p className="muted" style={{ fontSize: 14 }}>
          Last updated {doc.updated} · the canonical source is <code>docs/TERMS.md</code> in the
          repository.
        </p>
      )}
      <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
