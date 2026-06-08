import { AuthError, type Address } from '@querais/shared';

/**
 * Resolve the requester wallet from an `Authorization: Bearer <api-key>` header
 * against the configured key→wallet map. MVP auth — wallet-signature mode is deferred.
 */
export function resolveRequester(
  apiKeys: Map<string, Address>,
  authorization: string | undefined,
): Address {
  if (!authorization) throw new AuthError('Missing Authorization header');
  const key = authorization.replace(/^Bearer\s+/i, '').trim();
  const wallet = apiKeys.get(key);
  if (!wallet) throw new AuthError('Invalid API key');
  return wallet;
}
