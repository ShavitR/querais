import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '../../components/CodeBlock';
import { NodeEarnings } from '../../components/NodeEarnings';
import { SeeAlso } from '../../components/SeeAlso';
import { highlight } from '../../lib/highlight';
import { REPO_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Run a node',
  alternates: { canonical: '/for-node-operators/' },
  description:
    'Turn an idle GPU into income. Run the QueraIS node daemon, serve open LLMs, and earn 95% of every job in $QAIS. Hardware tiers from an 8 GB card to a datacenter A100, with an earnings estimator.',
};

const TIERS: { tier: string; gpu: string; vram: string; models: string; est: string }[] = [
  {
    tier: 'Bronze',
    gpu: 'GTX 1070 / RX 5700',
    vram: '8 GB',
    models: 'Llama-3-8B, Mistral-7B (Q4)',
    est: '$7–25 / mo',
  },
  {
    tier: 'Silver',
    gpu: 'RTX 3080 / 4070',
    vram: '12–16 GB',
    models: '8B FP16, 13B (Q8), Qwen2-7B',
    est: '$25–95 / mo',
  },
  {
    tier: 'Gold',
    gpu: 'RTX 4090 / 2× 3090',
    vram: '24 GB+',
    models: 'All Silver + Llama-3-70B (Q4)',
    est: '$75–255 / mo',
  },
  {
    tier: 'Platinum',
    gpu: 'A100 / A6000 / H100',
    vram: '40 GB+',
    models: 'Everything, full precision',
    est: '$400–4,000+ / mo',
  },
];

const dashboard = `🎉 Your node is LIVE
  status:        Active
  tier:          Silver  (stake 500 QAIS)
  models:        llama3.2, mistral-7b
  dashboard:     http://localhost:3000
  today:         $4.28   ·   this month: $127.50`;

const installWin = 'iwr -useb https://querais.xyz/install.ps1 | iex';
const installUnix = 'curl -fsSL https://querais.xyz/install.sh | sh';

export default async function ForNodeOperators() {
  const [bDash, bWin, bUnix] = await Promise.all([
    highlight(dashboard, 'text', 'node dashboard'),
    highlight(installWin, 'powershell', 'windows · powershell'),
    highlight(installUnix, 'bash', 'macos / linux'),
  ]);

  return (
    <div className="wrap page-head">
      <p className="kicker">Node operators</p>
      <h1>Turn an idle GPU into income</h1>
      <p className="lede">
        Run the QueraIS node, serve open-weight LLMs to the marketplace, and keep 95% of every job —
        paid in $QAIS. You set your own price; the network routes work to you based on price,
        reputation, and speed. Like BitTorrent seeding, but you get paid.
      </p>

      <div className="cta-row" style={{ justifyContent: 'flex-start', marginTop: 24 }}>
        <Link className="btn ghost" href="/tokenomics/">
          Staking &amp; rewards
        </Link>
      </div>

      <section className="block" style={{ borderTop: 'none', paddingTop: 28 }}>
        <h2>Install in one line</h2>
        <p className="muted">
          One command installs Node and Ollama if you need them, downloads and checksum-verifies the
          latest node, sets up a working config, and starts serving — nothing to edit, no second
          step. Testnet; your wallet stays on your machine.
        </p>
        <CodeBlock block={bWin} />
        <CodeBlock block={bUnix} />
        <p className="muted" style={{ fontSize: 14 }}>
          Prefer to do it by hand? Grab the archive from{' '}
          <a href={`${REPO_URL}/releases`}>GitHub Releases</a> and run the launcher — same result.
        </p>
      </section>

      <section className="block">
        <h2>Hardware tiers</h2>
        <p className="muted">
          From a gaming card to a datacenter GPU — your hardware decides which models you can serve
          and how many jobs you win.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>GPU</th>
                <th>VRAM</th>
                <th>Serves</th>
                <th>Est. earnings</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t.tier}>
                  <td>{t.tier}</td>
                  <td>{t.gpu}</td>
                  <td className="num">{t.vram}</td>
                  <td className="muted">{t.models}</td>
                  <td className="num">{t.est}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Earnings are rough estimates at 30–40% utilization and current testnet rates — not a
          promise. Real income depends on demand, your price, uptime, and reputation.
        </p>
      </section>

      <section className="block">
        <h2>Estimate your earnings</h2>
        <NodeEarnings />
      </section>

      <section className="block">
        <h2>Live in about ten minutes</h2>
        <ol className="steps" style={{ marginTop: 20 }}>
          <li>
            <b>Install.</b> Run the one-liner above. It installs Node + Ollama if missing, downloads
            the node, generates an encrypted wallet, and writes a working config — no editing.
          </li>
          <li>
            <b>Connect a wallet.</b> Create a fresh wallet or import one — it receives your $QAIS
            earnings.
          </li>
          <li>
            <b>Stake.</b> Lock the minimum $QAIS for your tier (from 100). Stake is your collateral
            and unlocks higher-value jobs.
          </li>
          <li>
            <b>Pick models.</b> Choose which open models to serve; downloads resume in the
            background and are SHA-256 verified.
          </li>
          <li>
            <b>Go live.</b> Your node announces over libp2p and starts bidding — appearing in the
            marketplace within a couple of minutes.
          </li>
        </ol>
        <CodeBlock block={bDash} />
      </section>

      <section className="block">
        <h2>How you earn</h2>
        <div className="grid3">
          <div className="card">
            <h3>95% to you</h3>
            <p>Each settled job pays the serving node 95%; the protocol keeps 5%.</p>
          </div>
          <div className="card">
            <h3>You set the price</h3>
            <p>
              Quote your own per-token price, or let the optional auto-pricer track market and load.
            </p>
          </div>
          <div className="card">
            <h3>Batched payouts</h3>
            <p>Earnings accrue in escrow and settle in batches — claim anytime for cents of gas.</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>What the daemon runs</h2>
        <p className="muted">
          A single binary handles everything — model management, inference, bidding, P2P, payments,
          and a local dashboard at <code>localhost:3000</code>.
        </p>
        <div className="grid2">
          <div className="card">
            <h3>Inference</h3>
            <p>llama.cpp by default (GGUF), with optional vLLM / ExLlamaV2 for advanced setups.</p>
          </div>
          <div className="card">
            <h3>Model manager</h3>
            <p>Registry sync, resumable downloads, SHA-256 integrity, dynamic VRAM load/unload.</p>
          </div>
          <div className="card">
            <h3>Job handler</h3>
            <p>WebSocket job feed, auto-bid calculator, result packaging, completion reporting.</p>
          </div>
          <div className="card">
            <h3>Safe by default</h3>
            <p>
              Auto-pauses bidding when your GPU is busy with other work; staking risk is bounded by
              clear <Link href="/security/">slashing rules</Link>.
            </p>
          </div>
        </div>
      </section>

      <SeeAlso
        links={[
          {
            href: '/tokenomics/',
            title: 'Tokenomics',
            desc: 'Staking tiers, the staker reward share, and burn.',
          },
          {
            href: '/security/',
            title: 'Security',
            desc: 'Reputation, slashing, and how disputes resolve.',
          },
          {
            href: '/how-it-works/',
            title: 'How it works',
            desc: 'Where your node sits in the job lifecycle.',
          },
        ]}
      />
    </div>
  );
}
