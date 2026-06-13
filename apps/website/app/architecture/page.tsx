import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureDiagram } from '../../components/ArchitectureDiagram';
import { SeeAlso } from '../../components/SeeAlso';

export const metadata: Metadata = {
  title: 'Architecture',
  alternates: { canonical: '/architecture/' },
  description:
    'How QueraIS works under the hood: the gateway, GPU nodes, oracle, and on-chain contracts; the request→match→serve→verify→settle lifecycle; the trusted-gateway model and the path to full decentralization.',
};

const COMPONENTS: { name: string; role: string }[] = [
  {
    name: 'Requester / developer',
    role: 'Sends OpenAI-style requests; pre-funds a credit account and signs one spending cap.',
  },
  {
    name: 'Gateway',
    role: 'The coordinator — auth, matching, streaming, verification, and batched settlement. Trusted today; bounded by signed prices.',
  },
  {
    name: 'GPU node',
    role: 'Stakes $QAIS, advertises models + price, runs inference, streams tokens, earns 95%.',
  },
  {
    name: 'Matching engine',
    role: 'Picks the serving node per job by price, reputation, latency, and capability.',
  },
  {
    name: 'Verification oracle',
    role: 'Re-runs ~5% of jobs on its own nodes and updates reputation; flags anomalies into disputes.',
  },
  {
    name: 'Smart contracts',
    role: 'Token, node registry + stake, credit/escrow, dispute resolution, and treasury — on Arbitrum.',
  },
];

const LIFECYCLE: { title: string; body: string }[] = [
  {
    title: 'Request',
    body: 'A developer calls /v1/chat/completions (OpenAI-compatible). The gateway normalizes it to a job spec and checks the requester’s signed credit headroom.',
  },
  {
    title: 'Match',
    body: 'The matching engine scores eligible nodes — price, reputation, latency, capability — and assigns the winner over a live WebSocket channel.',
  },
  {
    title: 'Serve',
    body: 'The node runs the model and streams tokens back through the gateway to the caller in real time.',
  },
  {
    title: 'Verify',
    body: 'Every job gets cheap format/length checks; ~5% are re-run on oracle nodes and compared by embedding similarity. The result updates the node’s reputation.',
  },
  {
    title: 'Settle',
    body: 'Debits accrue off-chain and flush in a batched on-chain transaction — 95% to the node, 5% to the protocol — amortizing gas to a fraction of a cent per job.',
  },
];

const STACK: { layer: string; tech: string }[] = [
  { layer: 'Blockchain', tech: 'Arbitrum Sepolia (EVM L2) — testnet today' },
  { layer: 'Contracts', tech: 'Solidity 0.8 + OpenZeppelin, transparent proxy (5 core)' },
  { layer: 'Gateway / API', tech: 'Node.js + Fastify (TypeScript), OpenAI-compatible REST' },
  { layer: 'Node daemon', tech: 'TypeScript daemon wrapping llama.cpp / Ollama' },
  { layer: 'Inference', tech: 'llama.cpp · Ollama (vLLM optional)' },
  { layer: 'Settlement', tech: 'EIP-712 signed sessions → batched on-chain (50–500 jobs/tx)' },
  { layer: 'Verification', tech: 'Sampled re-runs + format checks; 5-dimension EMA reputation' },
  { layer: 'Model integrity', tech: 'SHA-256 digests (IPFS pinning on the roadmap)' },
  { layer: 'Frontend', tech: 'React dashboard (served by the gateway) + this Next.js site' },
  { layer: 'P2P (roadmap)', tech: 'libp2p mesh for discovery + gossip' },
];

const PHASES: { phase: string; label: string; body: string }[] = [
  {
    phase: 'Today',
    label: 'Trusted gateway + on-chain settlement',
    body: 'One gateway does matching and batched settlement; stake, reputation, and payment are already on-chain. Worst case is bounded — see the trust model above.',
  },
  {
    phase: 'Next',
    label: 'On-chain auction',
    body: 'Job specs post on-chain; nodes submit sealed bids in a short window and a contract selects the winner — removing the gateway’s matching role.',
  },
  {
    phase: 'Then',
    label: 'P2P mesh + decentralized oracle',
    body: 'Nodes discover each other over a libp2p DHT and gossip jobs; verification moves to a decentralized oracle instead of protocol-run infrastructure.',
  },
  {
    phase: 'Goal',
    label: 'DAO governance',
    body: 'Arbitration and parameters move to on-chain governance; node participation is fully permissionless and the trusted gateway is gone.',
  },
];

export default function Architecture() {
  return (
    <div className="wrap page-head">
      <p className="kicker">Architecture</p>
      <h1>How QueraIS works</h1>
      <p className="lede">
        A coordinator (the gateway) matches your request to an open market of staked GPU nodes,
        streams the result back, samples it for honesty, and settles payment on-chain — 95% to the
        node, 5% to the protocol. Here’s the whole machine, and how the trusted parts get removed
        over time.
      </p>

      <div style={{ marginTop: 28 }}>
        <ArchitectureDiagram />
      </div>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <h2>The pieces</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENTS.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="muted">{c.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>A job, end to end</h2>
        <ol className="steps" style={{ marginTop: 20 }}>
          {LIFECYCLE.map((s) => (
            <li key={s.title}>
              <b>{s.title}.</b> {s.body}
            </li>
          ))}
        </ol>
      </section>

      <section className="block">
        <h2>Trust model — and why the worst case is bounded</h2>
        <p className="muted">
          Today a single gateway coordinates matching and settlement. That’s a real trust
          assumption, but a tightly fenced one:
        </p>
        <div className="grid2">
          <div className="card">
            <h3>Can’t steal deposits</h3>
            <p>
              Requester funds are locked in the credit contract; the gateway can only settle at the
              prices you already signed in each job spec.
            </p>
          </div>
          <div className="card">
            <h3>Can’t exceed your cap</h3>
            <p>Your EIP-712 spending cap bounds the most it can ever spend. Revoke in one tx.</p>
          </div>
          <div className="card">
            <h3>Can’t block refunds</h3>
            <p>Unclaimed deposits are withdrawable on-chain after a short notice window.</p>
          </div>
          <div className="card">
            <h3>Can’t fake quality</h3>
            <p>
              Sampled re-runs and staking/slashing make dishonest serving a losing trade — see{' '}
              <Link href="/security/">Security</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>The path to decentralization</h2>
        <p className="muted">
          Each step removes a piece of trust from the gateway. Sequencing is directional, not dated.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Step</th>
                <th>What changes</th>
              </tr>
            </thead>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p.phase}>
                  <td>
                    <span className="pill accent">{p.phase}</span>
                  </td>
                  <td>{p.label}</td>
                  <td className="muted">{p.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>Tech stack</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Today</th>
              </tr>
            </thead>
            <tbody>
              {STACK.map((s) => (
                <tr key={s.layer}>
                  <td>{s.layer}</td>
                  <td className="muted">{s.tech}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SeeAlso
        links={[
          {
            href: '/security/',
            title: 'Security',
            desc: 'Verification layers, reputation, slashing, and disputes.',
          },
          {
            href: '/roadmap/',
            title: 'Roadmap',
            desc: 'From testnet beta to full decentralization.',
          },
          {
            href: '/docs/api/',
            title: 'API reference',
            desc: 'Endpoints, auth, and request/response shapes.',
          },
        ]}
      />
    </div>
  );
}
