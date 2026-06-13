import type { Metadata } from 'next';
import { renderLegal } from '../../lib/legal';

export const metadata: Metadata = {
  title: 'Privacy Notice',
  alternates: { canonical: '/privacy/' },
  description:
    'QueraIS Privacy Notice — ~5% of prompts are re-run for verification, prompts/outputs are processed in memory (only hashes persist), and on-chain data is permanent. Read before sending a prompt.',
};

export default function Privacy() {
  const doc = renderLegal('PRIVACY.md');
  return (
    <div className="wrap page-head">
      <p className="kicker">Legal</p>
      <h1>Privacy Notice</h1>
      {doc.updated && (
        <p className="muted" style={{ fontSize: 14 }}>
          Last updated {doc.updated} · the canonical source is <code>docs/PRIVACY.md</code> in the
          repository.
        </p>
      )}
      <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
