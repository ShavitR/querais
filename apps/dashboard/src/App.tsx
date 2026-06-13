/**
 * App shell: header (live gateway status dot + nav + sign-in), the "testnet, no real value"
 * banner on every page, a tiny hash-routed view switch, and the disclosures footer. 10A stood
 * up the shell + Explorer; 10B-1 adds the requester console (Playground / Jobs / Usage). The
 * wallet (SIWE) sign-in and the deposit/session/EIP-712 flow are 10B-2.
 */
import { getStatus } from './api/client';
import { usePoll } from './hooks/usePoll';
import { useHashRoute } from './hooks/useHashRoute';
import { SignIn } from './components/SignIn';
import { Overview } from './views/Overview';
import { Playground } from './views/Playground';
import { Jobs } from './views/Jobs';
import { Usage } from './views/Usage';

const TERMS_URL = 'https://github.com/ShavitR/querais/blob/main/docs/TERMS.md';
const PRIVACY_URL = 'https://github.com/ShavitR/querais/blob/main/docs/PRIVACY.md';

const NAV = [
  { path: '/', label: 'explorer' },
  { path: '/playground', label: 'playground' },
  { path: '/jobs', label: 'jobs' },
  { path: '/usage', label: 'usage' },
];

export function App() {
  const status = usePoll(getStatus, 5000);
  const route = useHashRoute();
  // No data yet → assume up (warming); explicit down/degraded only once the gateway says so.
  const cls = status.error && !status.data ? 'down' : (status.data?.status ?? 'ok');

  return (
    <>
      <header className="header">
        <span className={`dot ${cls === 'ok' ? '' : cls}`} title={`gateway: ${cls}`} />
        <h1>QueraIS</h1>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={route === n.path ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        <SignIn />
      </header>
      <div className="banner">
        testnet — $QAIS and all balances have <b>no real value</b>. Nothing here is an offer or
        financial product.
      </div>
      <Route route={route} />
      <footer>
        <a href={TERMS_URL}>terms</a> · <a href={PRIVACY_URL}>privacy</a> ·{' '}
        <a href="https://github.com/ShavitR/querais">source</a>
      </footer>
    </>
  );
}

function Route({ route }: { route: string }) {
  switch (route) {
    case '/playground':
      return <Playground />;
    case '/jobs':
      return <Jobs />;
    case '/usage':
      return <Usage />;
    default:
      return <Overview />;
  }
}
