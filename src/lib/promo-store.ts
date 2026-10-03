/**
 * Promo persistence.
 *
 * The only module that reads or writes PromoCode rows. Everything above it
 * (the API route, the order handler) deals in the plain `PromoCode` shape from
 * lib/promos.ts and never in Prisma's Decimal types, so the pricing rules stay
 * testable without a database.
 *
 * Redemption counts are derived from ORDER rows rather than kept in a counter
 * column on the promo. A counter can drift out of step with the orders it
 * claims to count — a rolled-back order leaves it too high, a manually inserted
 * one leaves it too low — and a limit enforced off a wrong count silently
 * over- or under-promises.
 */

import { prisma } from './db';
import { normalizeCode, type PromoCode } from './promos';

interface PromoRow {
  id: string;
  code: string;
  kind: string;
  percentOff: unknown;
  amountOffUsd: unknown;
  minSubtotalUsd: unknown;
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  stackable: boolean;
  appliesToCategories: string | null;
}

/** Prisma Decimal -> number, tolerating the Decimal, string and number shapes. */
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  // Prisma.Decimal exposes toNumber/toString; duck-type rather than import.
  const maybe = value as { toNumber?: () => number; toString?: () => string };
  if (typeof maybe.toNumber === 'function') {
    const n = maybe.toNumber();
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof maybe.toString === 'function') {
    const n = Number(maybe.toString());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Turn a stored row into the shape lib/promos.ts consumes. */
export function rowToPromo(row: PromoRow): PromoCode {
  return {
    code: row.code,
    // An unrecognised kind stays unrecognised: validatePromo rejects it. We do
    // NOT coerce it to PERCENT, which would turn a typo into a live discount.
    kind: row.kind as PromoCode['kind'],
    percentOff: toNumber(row.percentOff),
    amountOffUsd: toNumber(row.amountOffUsd),
    minSubtotalUsd: toNumber(row.minSubtotalUsd),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxRedemptions: row.maxRedemptions,
    perCustomerLimit: row.perCustomerLimit,
    stackable: row.stackable,
    appliesToCategories: row.appliesToCategories
      ? row.appliesToCategories.split(',').map((s) => s.trim()).filter(Boolean)
      : null,
  };
}

/** Public form of a promo: never leaks internal ids or redemption counts. */
export interface PublicPromo {
  code: string;
  kind: PromoCode['kind'];
  minSubtotalUsd: number | null;
  endsAt: Date | null;
  stackable: boolean;
  description: string;
}

export function describePromo(promo: PromoCode): string {
  switch (promo.kind) {
    case 'PERCENT':
      return `${Math.round((promo.percentOff ?? 0) * 100)}% off`;
    case 'FIXED':
      return `$${promo.amountOffUsd ?? 0} off`;
    case 'FREE_SHIPPING':
      return 'Free shipping';
    default:
      return 'Discount';
  }
}

/**
 * Look up one code.
 *
 * `now` is applied in SQL so an expired code is never even loaded. The lookup is
 * an exact match on the NORMALISED code, so "first10" and "FIRST10" cannot
 * become two different promos.
 */
export async function findPromo(rawCode: string, now: Date): Promise<PromoCode | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  try {
    const row = await prisma.promoCode.findFirst({
      where: {
        code,
        active: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
    } as never);

    if (!row) return null;
    return rowToPromo(row as unknown as PromoRow);
  } catch (err) {
    // A promo lookup must never take checkout down. If the table is missing
    // (migrations not yet applied) the shopper simply sees no code accepted.
    console.error('[promos] lookup failed', err);
    return null;
  }
}

/** Total times this code has been redeemed, counted from orders. */
export async function redemptionCount(promoCodeId: string): Promise<number> {
  try {
    return await prisma.order.count({ where: { promoCodeId } });
  } catch (err) {
    console.error('[promos] redemption count failed', err);
    return 0;
  }
}

/** How many times THIS customer has already redeemed the code. */
export async function customerRedemptionCount(
  promoCodeId: string,
  userId: string | null,
  guestEmail: string | null,
): Promise<number> {
  if (!userId && !guestEmail) return 0;

  try {
    return await prisma.order.count({
      where: {
        promoCodeId,
        // Guests have no userId, so the email is the only identity available —
        // and a guest reusing another guest's email is not a limit we can
        // enforce without an account, which is why the seed codes are gentle.
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(guestEmail ? [{ guestEmail: guestEmail.toLowerCase() }] : []),
        ],
      },
    });
  } catch (err) {
    console.error('[promos] customer redemption count failed', err);
    return 0;
  }
}
