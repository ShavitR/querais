import { PRIVACY_URL, REPO_URL, STATUS_URL, TERMS_URL } from '../lib/site';

export function Footer() {
  return (
    <footer className="site">
      <div className="wrap inner">
        <span>QueraIS · testnet, no real value</span>
        <span className="spacer" />
        <a href={STATUS_URL}>Status</a>
        <a href={TERMS_URL}>Terms</a>
        <a href={PRIVACY_URL}>Privacy</a>
        <a href={REPO_URL}>GitHub</a>
      </div>
    </footer>
  );
}
