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
  { path: '/pricing/', priority: 0.8 },
  { path: '/faq/', priority: 0.6 },
  { path: '/docs/', priority: 0.7 },
  { path: '/docs/quickstart/', priority: 0.7 },
];

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

const fmt = (n: number): string => n.toLocaleString();
const qais = (wei: string): string =>
  (Number(wei) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Fetch headline numbers at BUILD time (static export). Gated on `NEXT_PUBLIC_GATEWAY_URL`
 * so CI builds stay hermetic (fallback dashes); the operator sets it for the real deploy.
 * Any failure falls back gracefully — the build never depends on the live gateway.
 */
export async function getHeadline(): Promise<Headline> {
  const base = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (!base) return FALLBACK;
  try {
    const opts = { signal: AbortSignal.timeout(5000) };
    const [stats, eco] = await Promise.all([
      fetch(`${base}/v1/stats`, opts).then((r) => r.json() as Promise<Stats>),
      fetch(`${base}/v1/network/economics`, opts).then((r) => r.json() as Promise<Economics>),
    ]);
    return {
      nodes: fmt(stats.nodes),
      jobsSettled: fmt(stats.jobs.settled),
      tokensServed: fmt(stats.jobs.tokensServed),
      burned: qais(eco.burnedWei),
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
  burnedWei: string;
}
