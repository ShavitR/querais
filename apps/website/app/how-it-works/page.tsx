import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How a QueraIS request flows: matching, real local inference, two-layer verification, and on-chain settlement (per-job escrow or batched).',
};

export default function HowItWorks() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h1>How it works</h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: 720 }}>
        A request becomes a matched job, real inference, two layers of verification, and an on-chain
        payment — in a couple of seconds.
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <ol className="steps">
          <li>
            <h3>Request</h3>
            <p className="muted">
              You call <code>POST /v1/chat/completions</code> (OpenAI-compatible) with a Bearer API
              key. Quota and prompt-abuse limits run before anything touches the chain.
            </p>
          </li>
          <li>
            <h3>Match</h3>
            <p className="muted">
              The gateway normalizes the request to a canonical job and the matching engine picks a
              node by price and reputation.
            </p>
          </li>
          <li>
            <h3>Serve</h3>
            <p className="muted">
              The node streams tokens back over a WebSocket; the gateway proxies them to you and
              counts independently — you&apos;re billed on <code>min(node, gateway)</code> tokens.
            </p>
          </li>
          <li>
            <h3>Verify</h3>
            <p className="muted">
              Layer-B checks structure (non-empty, length, loop detection, the node is pinned to
              what it sent). Layer-A re-runs ~5% of jobs on oracle inference and compares embedding
              similarity — anomalies are flagged for review, never auto-slashed.
            </p>
          </li>
          <li>
            <h3>Settle</h3>
            <p className="muted">
              With an open credit session the job settles off-chain against your signed cap and
              flushes in one <code>batchSettle</code>; otherwise it&apos;s a per-job escrow release.
              Either way: <b>95% to the node, 5% to the protocol treasury</b>.
            </p>
          </li>
          <li>
            <h3>Reputation &amp; economics</h3>
            <p className="muted">
              The node&apos;s 5-dimension score updates and snapshots on-chain daily. The treasury
              sweeps fees 60/20/20 (ops / stakers / burn) — the burn shrinks supply.
            </p>
          </li>
        </ol>
      </section>

      <p>
        <a className="btn" href={APP_URL}>
          See it live in the dashboard →
        </a>{' '}
        <Link className="btn ghost" href="/docs/quickstart/">
          Quickstart
        </Link>
      </p>
    </div>
  );
}
