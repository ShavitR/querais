import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Address } from 'viem';

/**
 * Slice 10A — stateless signed session cookies for the web app. No DB table (the thin-DB
 * rule): the cookie value is `base64url(payload).hexsig`, where the signature is an
 * HMAC-SHA256 over the payload keyed by a per-gateway secret. `verify` recomputes the MAC
 * in constant time and rejects expired or tampered tokens.
 *
 * The claims carry a `wallet` so the cookie is already wallet-shaped: 10B's wallet (SIWE)
 * sign-in mints the SAME cookie via a signature proof instead of an API key — this surface
 * does not change.
 */

/** The cookie name the app and the gateway agree on. */
export const SESSION_COOKIE = 'qais_session';

export interface SessionClaims {
  /** The requester wallet this session acts as. */
  wallet: Address;
  /** The API-key quota tier (informational for the UI). */
  tier: string;
  /** Absolute expiry, unix seconds. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export class SessionAuth {
  private readonly key: Buffer;
  readonly ttlSeconds: number;

  constructor(secret: string, ttlSeconds: number) {
    // Derive a fixed-length key from whatever secret we were given (never the raw
    // gateway private key — a distinct domain-separated digest).
    this.key = createHash('sha256').update(`querais-session:${secret}`).digest();
    this.ttlSeconds = ttlSeconds;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('hex');
  }

  /** Mint a cookie value for a signed-in principal. `nowSeconds` is injectable for tests. */
  mint(wallet: Address, tier: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
    const claims: SessionClaims = { wallet, tier, exp: nowSeconds + this.ttlSeconds };
    const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
    return `${payload}.${this.sign(payload)}`;
  }

  /** Verify + decode a cookie value; `null` on any tamper/format/expiry failure. */
  verify(
    token: string | undefined,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): SessionClaims | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(payload);
    // Constant-time compare; bail before the compare if the lengths differ.
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    let claims: SessionClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    } catch {
      return null;
    }
    if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) return null;
    if (typeof claims.wallet !== 'string') return null;
    return claims;
  }
}
