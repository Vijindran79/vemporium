/**
 * Order authorisation.
 *
 * The single place that decides "may this caller act on this order?". Two
 * endpoints depend on it — /api/checkout/create-intent and /api/orders/[id] —
 * and authorisation logic duplicated across endpoints is exactly how one of
 * them ends up missing a check.
 *
 * Exported as a `where` predicate rather than a fetch helper so the rule itself
 * can be unit tested without a database. It is the security boundary; it should
 * not only be verified by integration tests someone has to remember to write.
 *
 * Two callers, two proofs of ownership:
 *   - signed in  -> the session's user id must own the order
 *   - guest      -> the one-time checkoutToken, compared by SHA-256
 *
 * A caller with neither gets a predicate that cannot match anything. That is
 * deliberate: it is the same response as "no such order", so the endpoint never
 * distinguishes "not yours" from "does not exist". Differentiating them is
 * itself an enumeration oracle — order ids are guessable, and the 403-vs-404
 * difference leaks which ones exist.
 */

import type { Prisma } from '@prisma/client';
import { hashCheckoutToken } from './checkout-token';

/** A UUID that no real row can have, used to make a predicate match nothing. */
const DENY_ALL = '00000000-0000-0000-0000-000000000000';

export function orderAccessWhere(
  orderId: string,
  userId: string | null,
  checkoutToken: string | null,
): Prisma.OrderWhereInput {
  if (userId) return { id: orderId, userId };
  if (checkoutToken) return { id: orderId, checkoutTokenHash: hashCheckoutToken(checkoutToken) };
  return { id: orderId, AND: [{ id: DENY_ALL }] };
}

/**
 * Reads the guest capability token from a request.
 *
 * Header, NOT a query parameter. A token in the URL lands in browser history,
 * in the Referer header sent to every third-party script on the page, in access
 * logs and in analytics. It is a bearer credential for somebody's basket; it
 * does not belong in anything that gets written down.
 */
export function checkoutTokenFromRequest(request: Request): string | null {
  const raw = request.headers.get('x-checkout-token');
  if (!raw) return null;
  const token = raw.trim();
  // 43 chars is a base64url-encoded 32-byte value. Anything longer is either a
  // mistake or an attempt to make us hash something enormous.
  if (!token || token.length > 256) return null;
  return token;
}