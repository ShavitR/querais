import type { Metadata } from 'next';
import Link from 'next/link';
import { SeeAlso } from '../../components/SeeAlso';
import { CHAIN, contractUrl, CONTRACTS, getEconomics } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Tokenomics',
  alternates: { canonical: '/tokenomics/' },
  description:
    'The $QAIS token: a fixed 1,000,000,000 supply, a flat 5% protocol fee split 60/20/20 (operations / stakers / burn), staking tiers, and a deflationary burn. Live supply and burn numbers.',
};

const DISTRIBUTION: { bucket: string; pct: string; amount: string }[] = [
  { bucket: 'Ecosystem fund — node incentives + grants', pct: '30%', amount: '300,000,000' },
  { bucket: 'Community sale / IDO (public)', pct: '20%', amount: '200,000,000' },
  { bucket: 'Protocol treasury', pct: '15%', amount: '150,000,000' },
  { bucket: 'Team & founders', pct: '15%', amount: '150,000,000' },
  { bucket: 'Seed round (private)', pct: '5%', amount: '50,000,000' },
  { bucket: 'Series A (strategic)', pct: '5%', amount: '50,000,000' },
  { bucket: 'Liquidity (DEX pools)', pct: '5%', amount: '50,000,000' },
  { bucket: 'Advisors', pct: '3%', amount: '30,000,000' },
  { bucket: 'Airdrop / early users', pct: '2%', amount: '20,000,000' },
];

const VESTING: { bucket: string; cliff: string; vesting: string }[] = [
  { bucket: 'Team & founders', cliff: '12 months', vesting: '36 months linear (48mo total)' },
  { bucket: 'Seed round', cliff: '6 months', vesting: '24 months linear' },
  { bucket: 'Series A', cliff: '3 months', vesting: '18 months linear' },
  { bucket: 'Advisors', cliff: '6 months', vesting: '18 months linear' },
  { bucket: 'Community sale', cliff: 'none', vesting: '25% at TGE, 75% over 12 months' },
  { bucket: 'Liquidity', cliff: 'none', vesting: '100% at TGE (LP-locked ≥ 24 months)' },
  { bucket: 'Ecosystem fund', cliff: 'none', vesting: 'released by governance as earned' },
];

const STAKE_TIERS: { tier: string; stake: string; maxJob: string; access: string }[] = [
  { tier: 'Bronze', stake: '100 QAIS', maxJob: '$0.50 / job', access: 'All jobs' },
  { tier: 'Silver', stake: '500 QAIS', maxJob: '$5.00 / job', access: 'Premium jobs' },
  { tier: 'Gold', stake: '2,500 QAIS', maxJob: '$50.00 / job', access: 'Enterprise jobs' },
  { tier: 'Platinum', stake: '10,000 QAIS', maxJob: 'Unlimited', access: 'Priority routing' },
];

export default async function Tokenomics() {
  const eco = await getEconomics();
  const token = CONTRACTS.find((c) => c.name === 'QUAISToken');

  return (
    <div className="wrap page-head">
      <p className="kicker">Token</p>
      <h1>$QAIS token economics</h1>
      <p className="lede">
        One ERC-20 powers the whole marketplace: every inference job is priced and settled in $QAIS,
        nodes stake it as collateral, and a flat 5% protocol fee is split three ways — with a slice
        burned on every transaction. Fixed supply, no mint.
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 24 }}>
        <h2>Live on {CHAIN.name}</h2>
        <p className="muted">
          Numbers below are read from the token contract at build time
          {eco.live ? '' : ' (gateway offline at build — showing the fixed cap)'}. Testnet $QAIS has
          no real value.
        </p>
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat">
            <div className="n">{eco.totalSupply}</div>
            <div className="l">Total supply</div>
          </div>
          <div className="stat">
            <div className="n">{eco.burned}</div>
            <div className="l">Burned 🔥</div>
          </div>
          <div className="stat">
            <div className="n">{eco.treasury}</div>
            <div className="l">Treasury</div>
          </div>
          <div className="stat">
            <div className="n">{eco.stakerPool}</div>
            <div className="l">Staker pool</div>
          </div>
        </div>
        {token && (
          <p className="muted" style={{ fontSize: 14 }}>
            Token contract:{' '}
            <a className="addr" href={contractUrl(token.address)}>
              {token.address}
            </a>
          </p>
        )}
      </section>

      <section className="block">
        <h2>Fixed supply</h2>
        <div className="grid3">
          <div className="card">
            <h3>1,000,000,000</h3>
            <p>Total $QAIS, fixed at genesis. The token contract has no mint function.</p>
          </div>
          <div className="card">
            <h3>ERC-20 · 18 decimals</h3>
            <p>
              Designed for Arbitrum One at mainnet; live today on {CHAIN.name} (an Ethereum L2),
              testnet only.
            </p>
          </div>
          <div className="card">
            <h3>Deflationary</h3>
            <p>Every job permanently burns a fraction of supply — the float only shrinks.</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>Where the 5% fee goes</h2>
        <p className="muted">
          The protocol takes a flat 5% of every job — enforced in the settlement contract, not
          optional — and splits it three ways:
        </p>
        <div className="grid3">
          <div className="card">
            <h3>60% — operations</h3>
            <p>Retained by the protocol treasury for hosting, gas, R&amp;D, and grants.</p>
          </div>
          <div className="card">
            <h3>20% — stakers</h3>
            <p>Paid pro-rata to node operators who stake $QAIS and secure the network.</p>
          </div>
          <div className="card">
            <h3>20% — burned 🔥</h3>
            <p>Permanently removed from the fixed supply (≈1% of every job payment).</p>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>Initial distribution</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Allocation</th>
                <th>Share</th>
                <th>$QAIS</th>
              </tr>
            </thead>
            <tbody>
              {DISTRIBUTION.map((d) => (
                <tr key={d.bucket}>
                  <td>{d.bucket}</td>
                  <td className="num">{d.pct}</td>
                  <td className="num">{d.amount}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td className="num">
                  <b>100%</b>
                </td>
                <td className="num">
                  <b>1,000,000,000</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>Vesting &amp; unlocks</h2>
        <p className="muted">
          Insider allocations cliff and vest over years; only ~12.6% of supply unlocks at the token
          generation event.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Allocation</th>
                <th>Cliff</th>
                <th>Vesting</th>
              </tr>
            </thead>
            <tbody>
              {VESTING.map((v) => (
                <tr key={v.bucket}>
                  <td>{v.bucket}</td>
                  <td>{v.cliff}</td>
                  <td>{v.vesting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>Node staking tiers</h2>
        <p className="muted">
          Nodes post $QAIS as slashable collateral. A bigger stake unlocks higher-value jobs and
          better routing — skin in the game scales with what you can earn.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Min stake</th>
                <th>Max job value</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {STAKE_TIERS.map((t) => (
                <tr key={t.tier}>
                  <td>{t.tier}</td>
                  <td className="num">{t.stake}</td>
                  <td className="num">{t.maxJob}</td>
                  <td>{t.access}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <h2>What the token is for</h2>
        <div className="grid2">
          <div className="card">
            <h3>Payment</h3>
            <p>Every inference job is priced and settled in $QAIS — constant utility demand.</p>
          </div>
          <div className="card">
            <h3>Staking collateral</h3>
            <p>Nodes stake to participate; bad behaviour is slashed (see Security).</p>
          </div>
          <div className="card">
            <h3>Staking yield</h3>
            <p>20% of all protocol fees flow to stakers, pro-rata to stake.</p>
          </div>
          <div className="card">
            <h3>Governance</h3>
            <p>Staked $QAIS votes on fee rate, minimum stakes, and treasury allocation.</p>
          </div>
        </div>
      </section>

      <p className="muted" style={{ fontSize: 14 }}>
        Distribution, vesting, and tier figures are the protocol&apos;s mainnet design (see the{' '}
        <Link href="/security/">contracts on-chain</Link>); the network is currently testnet only.
      </p>

      <SeeAlso
        links={[
          {
            href: '/security/',
            title: 'Security & verification',
            desc: 'Slashing, disputes, and the contracts that hold the stake.',
          },
          {
            href: '/for-node-operators/',
            title: 'Run a node',
            desc: 'Stake $QAIS, serve models, earn 95% of every job.',
          },
          {
            href: '/pricing/',
            title: 'Pricing',
            desc: 'What a request costs and where the 5% goes.',
          },
        ]}
      />
    </div>
  );
}
