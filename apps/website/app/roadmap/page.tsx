import type { Metadata } from 'next';
import { SeeAlso } from '../../components/SeeAlso';

export const metadata: Metadata = {
  title: 'Roadmap',
  alternates: { canonical: '/roadmap/' },
  description:
    'Where QueraIS is headed: from the live testnet beta toward mainnet, an on-chain auction, a P2P mesh, a decentralized oracle, and DAO governance. Directional, not dated.',
};

type Status = 'Live' | 'Building' | 'Planned';

const PHASES: { status: Status; title: string; points: string[] }[] = [
  {
    status: 'Live',
    title: 'Testnet beta',
    points: [
      'Gateway, web app, and published SDKs (npm @querais/sdk, PyPI querais) all live.',
      'Five core contracts on Arbitrum Sepolia; faucet, staking, and on-chain settlement working.',
      'Open to early developers and node operators — bring a GPU or an API key.',
    ],
  },
  {
    status: 'Building',
    title: 'Open testnet & growth',
    points: [
      'More nodes and models; a node leaderboard and operator incentives.',
      'Deeper developer docs, examples, and framework integrations (LangChain, LlamaIndex).',
      'Hardening: observability, dispute tooling, and load testing.',
    ],
  },
  {
    status: 'Planned',
    title: 'Mainnet & token',
    points: [
      'Real $QAIS economics on Arbitrum One; seamless migration from testnet.',
      'Liquidity and exchange availability; first real settlements.',
      'A mainnet-readiness security audit gates the launch.',
    ],
  },
  {
    status: 'Planned',
    title: 'Scale & decentralization',
    points: [
      'On-chain sealed-bid auction replaces gateway matching.',
      'Standard-track arbitration panel for disputes.',
      'Multi-model routing and capacity planning as first-class concerns.',
    ],
  },
  {
    status: 'Planned',
    title: 'Full decentralization',
    points: [
      'P2P mesh (libp2p DHT) for discovery and job gossip — no bootstrap gateway.',
      'A decentralized verification oracle replaces protocol-run infrastructure.',
      'DAO governance over parameters and arbitration; the trusted gateway is gone.',
    ],
  },
];

const pillClass: Record<Status, string> = {
  Live: 'pill ok',
  Building: 'pill accent',
  Planned: 'pill',
};

export default function Roadmap() {
  return (
    <div className="wrap page-head">
      <p className="kicker">Roadmap</p>
      <h1>From testnet beta to a network with no operator</h1>
      <p className="lede">
        QueraIS launches centralized-but-bounded and removes trust step by step. This is the
        direction of travel — sequencing is intentional, exact timing is not promised, and testnet
        $QAIS has no real value.
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <ol className="steps" style={{ marginTop: 8 }}>
          {PHASES.map((p) => (
            <li key={p.title} style={{ paddingBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span className={pillClass[p.status]}>{p.status}</span>
                <b style={{ fontSize: 18 }}>{p.title}</b>
              </div>
              <ul style={{ margin: 0, color: 'var(--muted)' }}>
                {p.points.map((pt) => (
                  <li key={pt} style={{ marginBottom: 4 }}>
                    {pt}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <SeeAlso
        links={[
          {
            href: '/architecture/',
            title: 'Architecture',
            desc: 'The trust model these phases progressively remove.',
          },
          {
            href: '/for-node-operators/',
            title: 'Run a node',
            desc: 'Join the network while it’s early.',
          },
          {
            href: '/tokenomics/',
            title: 'Tokenomics',
            desc: 'The economics that go live at mainnet.',
          },
        ]}
      />
    </div>
  );
}
