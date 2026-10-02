/**
 * Guest checkout capability tokens.
 *
 * Guest checkout has no session, so /checkout/create-intent would otherwise
 * have nothing to authorise against — anyone could POST an order id and pay
 * for, or enumerate, somebody else's basket.
 *
 * So order creation mints a 256-bit random token, returns it ONCE, and stores
 * only its SHA-256. The client holds it in sessionStorage for the life of that
 * checkout attempt.
 *
 * SHA-256 rather than bcrypt: the input is 256 bits of CSPRNG output, so there
 * is no dictionary to attack and no need to be slow. (bcrypt is for
 * human-chosen passwords, where the cost buys brute-force resistance.)
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newCheckoutToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCheckoutToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 *
 * The lookup itself is an indexed equality match on the hash, so this is belt
 * and braces — but it costs nothing and removes any doubt about timing.
 */
export function checkoutTokenMatches(presented: string, storedHash: string | null): boolean {
  if (!storedHash || !presented) return false;
  const a = Buffer.from(hashCheckoutToken(presented), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}