import Link from 'next/link';
import { APP_URL, getHeadline } from '../lib/site';
import { JsonLd } from '../components/JsonLd';
import { softwareApplicationSchema } from '../lib/jsonld';
import { LifecycleDiagram } from '../components/LifecycleDiagram';
import { ComparisonTable } from '../components/ComparisonTable';
import { CtaLink } from '../components/CtaLink';

export default async function Home() {
  const h = await getHeadline();
  return (
    <>
      <JsonLd data={softwareApplicationSchema} />
      <section className="herobg">
        <div className="wrap hero">
          <h1>BitTorrent for AI inference</h1>
          <p className="lede">
            An OpenAI-compatible API served by independent GPU nodes that earn <b>$QAIS</b>. Every
            job settles on-chain — <b>95% to the node, 5% protocol fee</b>.
          </p>
          <div className="cta-row">
            <CtaLink event="open_app" href={APP_URL} className="btn">
              Open the dashboard →
            </CtaLink>
            <CtaLink event="quickstart" href="/docs/quickstart/" className="btn ghost">
              Quickstart
            </CtaLink>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="n">{h.nodes}</div>
              <div className="l">Active nodes</div>
            </div>
            <div className="stat">
              <div className="n">{h.jobsSettled}</div>
              <div className="l">Jobs settled</div>
            </div>
            <div className="stat">
              <div className="n">{h.tokensServed}</div>
              <div className="l">Tokens served</div>
            </div>
            <div className="stat">
              <div className="n">{h.burned} 🔥</div>
              <div className="l">$QAIS burned</div>
            </div>
          </div>
          {!h.live ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Live numbers appear when the site is built against the gateway.
            </p>
          ) : null}
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>How a job flows</h2>
          <p className="muted">
            Five stages from prompt to payment — coordinated by the gateway, settled on-chain.
          </p>
          <LifecycleDiagram />
          <p className="muted" style={{ fontSize: 14 }}>
            <Link href="/architecture/">See the full architecture →</Link>
          </p>
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>Two ways in</h2>
          <div className="grid2">
            <div className="card">
              <h3>🤖 Use the AI</h3>
              <p>
                Point any OpenAI client at the gateway and call it — streaming, a model picker, and
                pre-funded credit with a single signature.
              </p>
              <Link href="/for-developers/">For developers →</Link>
            </div>
            <div className="card">
              <h3>💸 Run a node, earn $QAIS</h3>
              <p>
                Got a GPU and Ollama? Install a prebuilt release in ~5 minutes, serve jobs, and earn
                for every token you stream.
              </p>
              <CtaLink event="run_node" href="/for-node-operators/">
                Run a node →
              </CtaLink>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>A real protocol, not a demo</h2>
          <div className="grid2">
            <div className="card">
              <h3>On-chain settlement</h3>
              <p>
                Deposit once, sign one EIP-712 spending cap, then fire thousands of calls — they
                settle in a single batch transaction with zero per-call wallet txs.
              </p>
            </div>
            <div className="card">
              <h3>Staking + slashing</h3>
              <p>
                Nodes stake $QAIS. A 5-dimension reputation score plus Layer-A semantic sampling
                catch cheaters; disputes slash stake.
              </p>
              <Link href="/security/">How verification works →</Link>
            </div>
            <div className="card">
              <h3>Deflationary token</h3>
              <p>
                The 5% fee splits 60% ops / 20% stakers / <b>20% burned</b>. Fixed 1B supply, no
                mint after launch.
              </p>
              <Link href="/tokenomics/">Tokenomics →</Link>
            </div>
            <div className="card">
              <h3>Prompt privacy</h3>
              <p>
                Verification stores hashes + scores only — prompt/output text is never persisted.
                ~5% of jobs are re-run on oracle infra to catch cheating.
              </p>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 20 }}>
            Trust model today: a single trusted gateway does matching + settlement (worst case is
            bounded — it can only settle at signed prices, never steal deposits). Removing it — P2P
            mesh, on-chain auction, decentralized oracle — is the{' '}
            <Link href="/roadmap/">roadmap</Link>.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="wrap">
          <h2>How we compare</h2>
          <p className="muted">
            Purpose-built for LLM inference — not general compute or rendering, and the only one
            your OpenAI code can call unchanged.
          </p>
          <ComparisonTable />
        </div>
      </section>

      <section className="block">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <h2>See the live network</h2>
          <p className="lede" style={{ margin: '0 auto 24px' }}>
            Browse active nodes, watch jobs settle, and try the playground — no install, no key
            needed to look around.
          </p>
          <div className="cta-row">
            <CtaLink event="open_app_explorer" href={APP_URL} className="btn">
              Open the app →
            </CtaLink>
            <Link className="btn ghost" href="/roadmap/">
              Roadmap
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
