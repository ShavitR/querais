import { AuthError, type Address } from '@querais/shared';
import type { SessionAuth } from './session.js';

/** Anything that can look up a wallet for an API key (the ApiKeyStore). */
export interface KeyLookup {
  get(key: string): Address | undefined;
}

/**
 * Resolve the requester wallet from an `Authorization: Bearer <api-key>` header
 * against the key store. MVP auth — wallet-signature mode is deferred.
 */
export function resolveRequester(store: KeyLookup, authorization: string | undefined): Address {
  if (!authorization) throw new AuthError('Missing Authorization header');
  const key = authorization.replace(/^Bearer\s+/i, '').trim();
  const wallet = store.get(key);
  if (!wallet) throw new AuthError('Invalid API key');
  return wallet;
}

/**
 * Slice 10A — accept EITHER a Bearer API key (SDK/CLI/web) OR a web-app session cookie.
 * Bearer wins when present (it's explicit and unambiguous); otherwise a valid session
 * cookie acts as the requester. Throws {@link AuthError} when neither authenticates.
 */
export function resolveRequesterOrSession(
  store: KeyLookup,
  session: SessionAuth,
  authorization: string | undefined,
  cookieToken: string | undefined,
): Address {
  if (authorization) return resolveRequester(store, authorization);
  const claims = session.verify(cookieToken);
  if (claims) return claims.wallet;
  throw new AuthError('Missing Authorization header');
}

/**
 * Slice 10C — require a web-app session cookie and return its wallet. Used by operator
 * routes that scope strictly to the signed-in node's OWN data (no `:wallet` param, so a
 * node operator can only ever see themselves). Throws {@link AuthError} if not signed in.
 */
export function requireWalletSession(
  session: SessionAuth,
  cookieToken: string | undefined,
): Address {
  const claims = session.verify(cookieToken);
  if (!claims) throw new AuthError('Sign in (wallet or API key) to view operator data');
  return claims.wallet;
}
