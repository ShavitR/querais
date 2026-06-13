/**
 * Session context: the signed-in principal (cookie-backed) plus sign-in/out actions.
 *
 * 10A ships API-key sign-in only (the gateway mints an httpOnly session cookie). The
 * context is intentionally credential-agnostic — 10B adds wallet (SIWE) sign-in by
 * minting the same cookie via a different proof, so this surface does not change.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createSiweMessage } from 'viem/siwe';
import type { Me } from '../api/types';
import {
  getCreditInfo,
  getMe,
  getSiweNonce,
  signInWithKey,
  signInWithWallet,
  signOut as apiSignOut,
} from '../api/client';
import { connect, signMessage } from '../lib/wallet';

interface SessionValue {
  me: Me | null;
  loading: boolean;
  error: string | null;
  signIn: (apiKey: string) => Promise<void>;
  signInWallet: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the cookie on first mount (read-only public mode if absent).
  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (alive) setMe(m);
      })
      .catch(() => {
        /* treat any hydration failure as signed-out */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (apiKey: string) => {
    setError(null);
    try {
      const m = await signInWithKey(apiKey.trim());
      setMe(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign-in failed');
      throw err;
    }
  }, []);

  // EIP-4361 wallet sign-in: connect → nonce → sign a SIWE message → exchange for the cookie.
  const signInWallet = useCallback(async () => {
    setError(null);
    try {
      const { address } = await connect();
      const info = await getCreditInfo();
      const { nonce } = await getSiweNonce();
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to QueraIS (testnet — no real value).',
        uri: window.location.origin,
        version: '1',
        chainId: info.chainId,
        nonce,
      });
      const signature = await signMessage(address, message);
      setMe(await signInWithWallet(message, signature));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'wallet sign-in failed');
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut().catch(() => undefined);
    setMe(null);
  }, []);

  return (
    <SessionContext.Provider value={{ me, loading, error, signIn, signInWallet, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
