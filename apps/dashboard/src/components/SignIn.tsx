/**
 * Sign-in control in the header. 10A: paste an API key → the gateway mints a session
 * cookie (the key is never stored in the browser). Signed in, shows the wallet + a
 * sign-out. Wallet (SIWE) sign-in arrives in 10B alongside the side that needs a wallet.
 */
import { useState } from 'react';
import { useSession } from '../auth/session';

export function SignIn() {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);

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

  return open ? (
    <KeyForm onDone={() => setOpen(false)} />
  ) : (
    <button className="ghost" onClick={() => setOpen(true)}>
      sign in
    </button>
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
