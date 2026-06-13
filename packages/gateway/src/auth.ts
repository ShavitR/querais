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
