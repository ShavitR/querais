import type { Metadata } from 'next';
import Link from 'next/link';
import { SeeAlso } from '../../components/SeeAlso';
import { CHAIN, contractUrl, CONTRACTS } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Security & verification',
  alternates: { canonical: '/security/' },
  description:
    'How QueraIS keeps an open marketplace honest: layered output verification, a 5-dimension reputation score, stake slashing, commit-reveal dispute arbitration, and five audited on-chain contracts.',
};

const DIMENSIONS: { name: string; weight: number; basis: string }[] = [
  { name: 'Accuracy', weight: 40, basis: 'EMA of verified job outcomes (sampled re-runs)' },
  { name: 'Uptime', weight: 25, basis: 'Availability over a 30-day rolling window' },
  { name: 'Latency', weight: 15, basis: 'P95 response time vs the network median' },
  { name: 'Longevity', weight: 10, basis: 'Active days, saturating at one year' },
  { name: 'Stake', weight: 10, basis: 'Staked $QAIS, saturating at 10,000' },
];

const SLASHING: { violation: string; slash: string }[] = [
  { violation: 'Job abandonment (accepted, then dropped)', slash: '1%' },
  { violation: 'Verified result failure (first offense)', slash: '5%' },
  { violation: 'Verified result failure (repeat — doubles)', slash: '10%+' },
  { violation: 'Downtime SLA breach (>5% in a month)', slash: '2%' },
  { violation: 'Dispute loss (minor)', slash: '10%' },
  { violation: 'Dispute loss (major fraud)', slash: '50%' },
  { violation: 'Sybil collusion detected', slash: '100% + ban' },
];

export default function Security() {
  return (
    <div className="wrap page-head">
      <p className="kicker">Security</p>
      <h1>Trust an open network of strangers&apos; GPUs</h1>
      <p className="lede">
        Anyone can run a node, so the protocol assumes nodes may lie. Four independent checks catch
        bad output, a reputation score compounds the signal, and stake gets slashed when fraud is
        proven on-chain — honesty is simply the cheaper strategy.
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <h2>Four layers of verification</h2>
        <div className="grid2">
          <div className="card">
            <h3>A · Statistical re-runs</h3>
            <p>
              ~5% of jobs are re-run on oracle-controlled nodes and compared by embedding cosine
              similarity (not hashes — floating-point makes exact matches impossible). Below 0.70
              flags an anomaly and opens a dispute.
            </p>
          </div>
          <div className="card">
            <h3>B · Format &amp; length</h3>
            <p>
              100% of jobs get cheap deterministic checks — non-null, correct format, token count in
              range, no repeated-token loops. Violations penalize reputation instantly, no dispute
              needed.
            </p>
          </div>
          <div className="card">
            <h3>C · Economic stake</h3>
            <p>
              Every node posts ≥100 $QAIS as slashable collateral. A node earning cents per job
              won&apos;t risk thousands in stake to cheat — the math favors honesty.
            </p>
          </div>
          <div className="card">
            <h3>D · Requester feedback</h3>
            <p>
              Requesters submit a satisfaction signal, weighted by their own reputation. A soft
              input only — it nudges the score but can never trigger a slash on its own.
            </p>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          Before each job, a node publishes a signed commitment to{' '}
          <code>hash(model_id · weights_hash · backend · node_id)</code> — proving which model ran
          without revealing the output.
        </p>
      </section>

      <section className="block">
        <h2>Reputation — five weighted dimensions</h2>
        <p className="muted">
          One score in <b>[0, 1]</b>, a weighted blend of five signals. Accuracy uses a single
          exponential moving average, so a node earns trust gradually and loses it fast — anomalies
          and lost disputes decay the score 10–20× quicker than a normal pass.
        </p>
        <div style={{ maxWidth: 640, marginTop: 20 }}>
          {DIMENSIONS.map((d) => (
            <div className="dim" key={d.name}>
              <div className="dim-top">
                <b>{d.name}</b>
                <span className="w">{d.weight}%</span>
              </div>
              <div className="dim-track">
                <div className="dim-fill" style={{ width: `${d.weight * 2}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {d.basis}
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>
          New nodes start at 0.70 after a 30-job onboarding and must clear 30 verified jobs before
          the score can trigger an automatic slash. Snapshots commit on-chain every 24 hours.
        </p>
      </section>

      <section className="block">
        <h2>Slashing</h2>
        <p className="muted">
          Proven bad behaviour burns stake. The penalty scales with severity and doubles for repeat
          offenders.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Violation</th>
                <th>Stake slashed</th>
              </tr>
            </thead>
            <tbody>
              {SLASHING.map((s) => (
                <tr key={s.violation}>
                  <td>{s.violation}</td>
                  <td className="num">{s.slash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid3" style={{ marginTop: 20 }}>
          <div className="card">
            <h3>50% — burned</h3>
            <p>Slashed stake is partly destroyed, deepening the deflationary pressure.</p>
          </div>
          <div className="card">
            <h3>30% — challenger</h3>
            <p>The party who raised a winning dispute is rewarded from the slash.</p>
          </div>
          <div className="card">
            <h3>20% — treasury</h3>
            <p>The remainder funds protocol operations.</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>Disputes — commit-reveal arbitration</h2>
        <p className="muted">
          Contested jobs go to a randomly selected panel. Votes are committed as hashes, then
          revealed together — no arbitrator can copy another&apos;s vote, killing herd bias.
        </p>
        <ol className="steps" style={{ marginTop: 20 }}>
          <li>
            <b>File.</b> A requester, the oracle, or any staker raises a dispute with a 50 $QAIS
            bond (refunded on a win, burned on a loss).
          </li>
          <li>
            <b>Commit (48h).</b> Five arbitrators — high-reputation nodes and long-term stakers —
            each submit <code>hash(vote · salt)</code>. No one sees another&apos;s choice.
          </li>
          <li>
            <b>Reveal (24h).</b> Everyone reveals vote + salt simultaneously; a preliminary outcome
            is set by supermajority.
          </li>
          <li>
            <b>Verify &amp; reward.</b> Where feasible, the oracle re-runs the job to confirm the
            truth. Arbitrators are paid for being <b>correct</b> — not for siding with the majority
            — so voting against a wrong crowd pays the most.
          </li>
        </ol>
      </section>

      <section className="block">
        <h2>On-chain contracts</h2>
        <p className="muted">
          Five core contracts (plus two supporting), OpenZeppelin-based, behind a transparent proxy
          with a multisig admin and a timelock on upgrades. Live on {CHAIN.name}:
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Responsibility</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c) => (
                <tr key={c.name}>
                  <td>
                    {c.name}
                    {!c.core && (
                      <>
                        {' '}
                        <span className="pill">support</span>
                      </>
                    )}
                  </td>
                  <td className="muted">{c.blurb}</td>
                  <td>
                    <a className="addr" href={contractUrl(c.address)}>
                      {c.address.slice(0, 10)}…{c.address.slice(-6)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>Settlement can&apos;t over-charge you</h2>
        <p className="muted">
          Requesters pre-fund a credit account, then sign one EIP-712 spending cap off-chain. The
          gateway batches thousands of jobs into a single settlement transaction, but can only ever
          settle at the prices in your signed job specs — and never beyond the cap. Worst case, a
          compromised gateway settles agreed work; your principal is never at risk, and you can
          revoke in one transaction.
        </p>
      </section>

      <p className="muted" style={{ fontSize: 14 }}>
        Figures reflect the protocol design in the <Link href="/tokenomics/">token economics</Link>{' '}
        spec; parameters are governance-adjustable and the network is currently testnet only.
      </p>

      <SeeAlso
        links={[
          {
            href: '/tokenomics/',
            title: 'Tokenomics',
            desc: 'Supply, the 60/20/20 fee split, and staking tiers.',
          },
          {
            href: '/how-it-works/',
            title: 'How it works',
            desc: 'The job lifecycle from prompt to on-chain settlement.',
          },
          {
            href: '/for-developers/',
            title: 'For developers',
            desc: 'Route by minimum reputation and price ceiling.',
          },
        ]}
      />
    </div>
  );
}
