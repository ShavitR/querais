/**
 * Sign-in control in the header. Two paths, one cookie session:
 *  - API key (10A) — paste a key; the gateway mints a cookie (the key is never stored).
 *  - Wallet (10B-2) — EIP-4361 "Sign-In with Ethereum" via the browser wallet.
 * Signed in, shows the wallet + a sign-out.
 */
import { useState } from 'react';
import { useSession } from '../auth/session';
import { hasWallet } from '../lib/wallet';

export function SignIn() {
  const { me, error, signInWallet, signOut } = useSession();
  const [mode, setMode] = useState<'idle' | 'key'>('idle');
  const [busy, setBusy] = useState(false);

  if (me) {
    return (
      <div className="row">
        <span className="badge">{me.tier}</span>
        <span className="muted" title={me.wallet}>
          {me.wallet.slice(0, 6)}…{me.wallet.slice(-4)}
        </span>
        <button className="ghost" onClick={() => void signOut()}>
          sign out
        </button>
      </div>
    );
  }

  if (mode === 'key') return <KeyForm onDone={() => setMode('idle')} />;

  const connectWallet = async () => {
    setBusy(true);
    try {
      await signInWallet();
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <button className="ghost" onClick={() => setMode('key')}>
        API key
      </button>
      {hasWallet() ? (
        <button disabled={busy} onClick={() => void connectWallet()}>
          {busy ? 'check wallet…' : 'connect wallet'}
        </button>
      ) : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

function KeyForm({ onDone }: { onDone: () => void }) {
  const { signIn, error } = useSession();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await signIn(key);
      onDone();
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <input
        type="password"
        placeholder="sk-querais-…"
        value={key}
        autoFocus
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <button disabled={busy} onClick={() => void submit()}>
        {busy ? '…' : 'sign in'}
      </button>
      <button className="ghost" onClick={onDone}>
        cancel
      </button>
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
