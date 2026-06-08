import { AuthError, type Address } from '@querais/shared';

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
