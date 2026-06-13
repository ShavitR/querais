/**
 * App shell: header (live gateway status dot + sign-in), the "testnet, no real value"
 * banner that rides every page, the overview view, and the disclosures footer. 10A is the
 * foundation — routing and the requester/operator/explorer consoles land in 10B–10D.
 */
import { getStatus } from './api/client';
import { usePoll } from './hooks/usePoll';
import { SignIn } from './components/SignIn';
import { Overview } from './views/Overview';

const TERMS_URL = 'https://github.com/ShavitR/querais/blob/main/docs/TERMS.md';
const PRIVACY_URL = 'https://github.com/ShavitR/querais/blob/main/docs/PRIVACY.md';

export function App() {
  const status = usePoll(getStatus, 5000);
  // No data yet → assume up (warming); explicit down/degraded only once the gateway says so.
  const cls = status.error && !status.data ? 'down' : (status.data?.status ?? 'ok');

  return (
    <>
      <header className="header">
        <span className={`dot ${cls === 'ok' ? '' : cls}`} title={`gateway: ${cls}`} />
        <h1>QueraIS</h1>
        <span className="muted">decentralized AI compute marketplace</span>
        <span className="spacer" />
        <SignIn />
      </header>
      <div className="banner">
        testnet — $QAIS and all balances have <b>no real value</b>. Nothing here is an offer or
        financial product.
      </div>
      <Overview />
      <footer>
        <a href={TERMS_URL}>terms</a> · <a href={PRIVACY_URL}>privacy</a> ·{' '}
        <a href="https://github.com/ShavitR/querais">source</a>
      </footer>
    </>
  );
}
