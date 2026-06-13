/** Shared constants + the build-time headline-numbers fetch for the marketing site. */

export const SITE_URL = 'https://querais.xyz';
export const APP_URL = 'https://gateway.querais.xyz/';
export const REPO_URL = 'https://github.com/ShavitR/querais';
export const STATUS_URL = 'https://gateway.querais.xyz/status';
export const TERMS_URL = 'https://github.com/ShavitR/querais/blob/main/docs/TERMS.md';
export const PRIVACY_URL = 'https://github.com/ShavitR/querais/blob/main/docs/PRIVACY.md';

/** Every indexable route (path, change-freq, priority) — the single source for the sitemap. */
export const ROUTES: { path: string; priority: number }[] = [
  { path: '/', priority: 1.0 },
  { path: '/how-it-works/', priority: 0.8 },
  { path: '/for-developers/', priority: 0.9 },
  { path: '/for-node-operators/', priority: 0.9 },
  { path: '/pricing/', priority: 0.8 },
  { path: '/tokenomics/', priority: 0.8 },
  { path: '/security/', priority: 0.8 },
  { path: '/architecture/', priority: 0.7 },
  { path: '/roadmap/', priority: 0.6 },
  { path: '/faq/', priority: 0.6 },
  { path: '/docs/', priority: 0.7 },
  { path: '/docs/quickstart/', priority: 0.7 },
  { path: '/docs/api/', priority: 0.7 },
  { path: '/terms/', priority: 0.3 },
  { path: '/privacy/', priority: 0.3 },
];

/** The testnet chain the protocol is live on, and its block explorer. */
export const CHAIN = {
  name: 'Arbitrum Sepolia',
  id: 421614,
  explorer: 'https://sepolia.arbiscan.io',
};

/** Deployed contracts (Arbitrum Sepolia). Mirrors deployments/addresses.arbitrumSepolia.json. */
export const CONTRACTS: { name: string; address: string; blurb: string; core: boolean }[] = [
  {
    name: 'QUAISToken',
    address: '0x5532663d4d4560d9923e30fb7230b82edcb25531',
    blurb: 'ERC-20 with burn(); fixed 1B supply, no mint after genesis.',
    core: true,
  },
  {
    name: 'NodeRegistry',
    address: '0xe9674474f7450b8fdc88895f7646d0d5fc34e99a',
    blurb: 'Stake, tiers, reputation storage, suspension/deactivation.',
    core: true,
  },
  {
    name: 'JobEscrow',
    address: '0x9a8be9ad9f980e828757163780aea1ca46303267',
    blurb: 'Per-job fund locking, verified release, refunds, job records.',
    core: true,
  },
  {
    name: 'DisputeResolution',
    address: '0x546b548bf5401aad0a21e85ce750aad5e58d8013',
    blurb: 'Commit-reveal arbitration, arbitrator rewards, slash execution.',
    core: true,
  },
  {
    name: 'ProtocolTreasury',
    address: '0x83acf7b9a8182a6398c1fd80d0e237011e903fa2',
    blurb: 'Fee accrual, burn execution, staker + operations allocation.',
    core: true,
  },
  {
    name: 'CreditAccount',
    address: '0xc148e3d305a35876d9df211dbc9ef944ab4c8191',
    blurb: 'Pre-funded deposits + EIP-712 capped batch settlement.',
    core: false,
  },
  {
    name: 'StakingRewards',
    address: '0x8fa6ec119ae18f0793d1ec0eb0525e9f6f6b648f',
    blurb: 'Distributes the 20% staker share of protocol fees.',
    core: false,
  },
];

export const contractUrl = (address: string): string => `${CHAIN.explorer}/address/${address}`;

export interface Headline {
  nodes: string;
  jobsSettled: string;
  tokensServed: string;
  burned: string;
  live: boolean;
}

const FALLBACK: Headline = {
  nodes: '—',
  jobsSettled: '—',
  tokensServed: '—',
  burned: '—',
  live: false,
};

const fmt = (n: number): string => (Number.isFinite(n) ? n.toLocaleString() : '—');
const qais = (wei: string | undefined): string => {
  const n = Number(wei) / 1e18;
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
};

/** GET + parse JSON at build time, throwing on any non-2xx so callers fall back cleanly. */
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

/**
 * Fetch headline numbers at BUILD time (static export). Gated on `NEXT_PUBLIC_GATEWAY_URL`
 * so CI builds stay hermetic (fallback dashes); the operator sets it for the real deploy.
 * Resilient per-endpoint: /v1/stats drives the live flag, while /v1/network/economics (a newer
 * route an older deployed gateway may 404) only fills in `burned` — so the working stats still
 * render even when economics is unavailable. Any total failure falls back gracefully.
 */
export async function getHeadline(): Promise<Headline> {
  const base = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (!base) return FALLBACK;
  try {
    const stats = await getJson<Stats>(`${base}/v1/stats`);
    let burned = '—';
    try {
      const eco = await getJson<Economics>(`${base}/v1/network/economics`);
      burned = qais(eco.burnedWei);
    } catch {
      /* economics route optional — older gateways 404 it */
    }
    return {
      nodes: fmt(stats.nodes),
      jobsSettled: fmt(stats.jobs.settled),
      tokensServed: fmt(stats.jobs.tokensServed),
      burned,
      live: true,
    };
  } catch {
    return FALLBACK;
  }
}

interface Stats {
  nodes: number;
  jobs: { settled: number; tokensServed: number };
}
interface Economics {
  totalSupplyWei: string;
  burnedWei: string;
  treasuryBalanceWei: string;
  stakerPoolWei: string;
}

export interface NetworkEconomics {
  totalSupply: string;
  burned: string;
  treasury: string;
  stakerPool: string;
  live: boolean;
}

const ECONOMICS_FALLBACK: NetworkEconomics = {
  totalSupply: '1,000,000,000',
  burned: '—',
  treasury: '—',
  stakerPool: '—',
  live: false,
};

/**
 * Fetch live token-economics numbers at BUILD time (static export), same hermetic pattern as
 * getHeadline(): gated on NEXT_PUBLIC_GATEWAY_URL, any failure falls back gracefully so the
 * build never depends on the live gateway. Powers the supply/burn widget on /tokenomics.
 */
export async function getEconomics(): Promise<NetworkEconomics> {
  const base = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (!base) return ECONOMICS_FALLBACK;
  try {
    const eco = await getJson<Economics>(`${base}/v1/network/economics`);
    if (!eco?.totalSupplyWei) return ECONOMICS_FALLBACK;
    return {
      totalSupply: qais(eco.totalSupplyWei),
      burned: qais(eco.burnedWei),
      treasury: qais(eco.treasuryBalanceWei),
      stakerPool: qais(eco.stakerPoolWei),
      live: true,
    };
  } catch {
    return ECONOMICS_FALLBACK;
  }
}
