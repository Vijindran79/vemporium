/**
 * Promotional codes: validation and discount arithmetic.
 *
 * This module is deliberately pure — it takes a promo row plus a basket and
 * returns a verdict. No database, and the current time is passed in rather than
 * read from the clock. Two reasons:
 *
 *   1. The rules below decide what we charge, so they are the rules most worth
 *      testing. (An over-generous discount is a real margin loss; an
 *      under-generous one is a support ticket.)
 *   2. The API route re-derives the discount from the STORED order. If the
 *      client sends "discount: 40" we ignore it. This module is the only thing
 *      allowed to produce a discount number.
 *
 * Money is rounded to cents at every step. Rounding once at the end compounds
 * differently on every basket, which makes two carts that should match differ
 * by a cent — and cent-level mismatches are what make a real invoice fail.
 *
 * NOTE ON CUSTOMS: a discount lowers the declared value, so duty is re-computed
 * on the discounted goods value rather than the pre-discount one. That is the
 * standard retail treatment, and it is also why the tax base here is the same
 * number: we never invoice duty on an amount the customer did not pay.
 */

import { calculateLandedCost, type LandedCostBreakdown } from './duties';

export type PromoKind = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

export interface PromoCode {
  code: string;
  kind: PromoKind;
  /** Fraction off the goods value, 0..1. Only for PERCENT. */
  percentOff?: number;
  /** Amount off the goods value in USD. Only for FIXED. */
  amountOffUsd?: number;
  /** Order must reach this goods value (USD) to qualify. */
  minSubtotalUsd?: number;
  startsAt: Date;
  /** null means "no expiry". */
  endsAt: Date | null;
  /** null means unlimited. */
  maxRedemptions: number | null;
  /** null means unlimited per customer. */
  perCustomerLimit: number | null;
  /** False (the default) means this code stands alone. */
  stackable: boolean;
  /** null/empty means every category. */
  appliesToCategories: string[] | null;
}
export interface PromoContext {
  promo: PromoCode;
  /** Goods value in USD, as priced server-side. */
  goodsUsd: number;
  destinationCountry: string | null;
  /** Client time, passed in so the rule is testable. */
  now: Date;
  /** Times this specific customer has already redeemed it. */
  customerRedemptions?: number;
  /** Codes already applied to this basket, if any. */
  alreadyApplied?: string[];
}

export type PromoRejectionReason =
  | 'UNKNOWN'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'BELOW_MINIMUM'
  | 'EXHAUSTED'
  | 'CUSTOMER_LIMIT'
  | 'NOT_STACKABLE'
  | 'CATEGORY_EXCLUDED'
  | 'NO_MATCHING_ITEMS'
  | 'MALFORMED';

export type PromoVerdict =
  | {
      ok: true;
      code: string;
      /** Reduction in goods value, USD. Zero for FREE_SHIPPING. */
      discountUsd: number;
      /** True when this code zeroes the shipping line. */
      freeShipping: boolean;
      /** Goods value the duty/tax engine must use. */
      discountedGoodsUsd: number;
    }
  | { ok: false; code: string; reason: PromoRejectionReason; message: string };

/** Round to whole cents. Every money value in this module passes through here. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Human-facing copy per rejection, so the API never invents its own wording. */
const MESSAGES: Record<PromoRejectionReason, string> = {
  UNKNOWN: 'That code is not recognised.',
  NOT_STARTED: 'That code is not active yet.',
  EXPIRED: 'That code has expired.',
  BELOW_MINIMUM: 'Your order does not reach the minimum for this code.',
  EXHAUSTED: 'That code has been fully redeemed.',
  CUSTOMER_LIMIT: 'You have already used this code.',
  NOT_STACKABLE: 'That code cannot be combined with another offer.',
  CATEGORY_EXCLUDED: 'That code does not apply to anything in your bag.',
  NO_MATCHING_ITEMS: 'No item in your bag qualifies for this code.',
  MALFORMED: 'That code is not valid.',
};

function reject(code: string, reason: PromoRejectionReason): PromoVerdict {
  return { ok: false, code, reason, message: MESSAGES[reason] };
}

/**
 * Codes are compared case-insensitively and ignore surrounding whitespace, so a
 * shopper pasting " first10 " is not told their code is invalid. We do NOT strip
 * dashes or ignore case *within* the code: "FIRST10" and "FIRST-10" are
 * different codes, and silently conflating them would let one code's rules
 * apply to another's basket.
 */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Structural check on a promo row, independent of any basket.
 *
 * A malformed row must be REJECTED rather than coerced: if `percentOff` is 1.5
 * we cannot clamp it to 1.0 and keep going, because a promotion that pays more
 * than it charges is a hole in the pricing engine, not a typo to paper over.
 */
export function validatePromo(promo: PromoCode): PromoVerdict | null {
  const code = normalizeCode(promo.code);

  if (!code || code.length > 32) return reject(code, 'MALFORMED');

  switch (promo.kind) {
    case 'PERCENT': {
      const p = promo.percentOff;
      // Must be a real discount: >0 and <1. A 100%-off code is a giveaway and
      // almost always a config mistake, so it is malformed rather than valid.
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p >= 1) {
        return reject(code, 'MALFORMED');
      }
      break;
    }
    case 'FIXED': {
      const a = promo.amountOffUsd;
      if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0) {
        return reject(code, 'MALFORMED');
      }
      break;
    }
    case 'FREE_SHIPPING':
      // No parameters to validate.
      break;
    default:
      return reject(code, 'MALFORMED');
  }

  if (promo.minSubtotalUsd !== undefined && promo.minSubtotalUsd !== null) {
    const m = promo.minSubtotalUsd;
    if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) {
      return reject(code, 'MALFORMED');
    }
  }

  for (const limit of [promo.perCustomerLimit, promo.maxRedemptions]) {
    if (limit === undefined || limit === null) continue;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
      return reject(code, 'MALFORMED');
    }
  }

  return null;
}

/**
 * Validate a promo against a basket.
 *
 * Order of checks matters and is deliberate: structural validity, then the
 * time window, then stackability, then basket shape (minimum, categories),
 * then usage limits. A shopper who has used up a code should be told that
 * rather than "your bag is too small", because that is the thing they cannot
 * fix by spending more.
 */
export function evaluatePromo(ctx: PromoContext): PromoVerdict {
  const code = normalizeCode(ctx.promo.code);
  const structural = validatePromo(ctx.promo);
  if (structural) return structural;

  const { promo, now } = ctx;

  // --- Time window ---------------------------------------------------------
  if (now.getTime() < promo.startsAt.getTime()) return reject(code, 'NOT_STARTED');
  if (promo.endsAt !== null && now.getTime() > promo.endsAt.getTime()) {
    return reject(code, 'EXPIRED');
  }

  // --- Stackability --------------------------------------------------------
  // Checked before the minimum, because "cannot be combined" is a property of
  // the basket's OTHER codes, not of this basket's size.
  if (!promo.stackable && (ctx.alreadyApplied?.length ?? 0) > 0) {
    return reject(code, 'NOT_STACKABLE');
  }

  // --- Categories ----------------------------------------------------------
  // An explicit empty list is a misconfiguration: it would silently exclude the
  // entire catalog, so it is reported rather than quietly matching nothing.
  if (promo.appliesToCategories !== null && promo.appliesToCategories !== undefined) {
    if (promo.appliesToCategories.length === 0) return reject(code, 'CATEGORY_EXCLUDED');
  }

  // --- Usage limits --------------------------------------------------------
  // Checked BEFORE the minimum spend, and deliberately so. Telling someone who
  // has already redeemed a code that their basket is too small invites them to
  // spend more for nothing — the one response that cannot fix their problem.
  const used = ctx.customerRedemptions ?? 0;
  if (promo.perCustomerLimit !== null && promo.perCustomerLimit !== undefined && used >= promo.perCustomerLimit) {
    return reject(code, 'CUSTOMER_LIMIT');
  }

  // --- Minimum spend -------------------------------------------------------
  const subtotal = round2(ctx.goodsUsd);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    // A zero-value basket qualifies for nothing. Rejecting here also stops a
    // NaN price from reaching the arithmetic below.
    return reject(code, 'NO_MATCHING_ITEMS');
  }
  if (promo.minSubtotalUsd !== undefined && promo.minSubtotalUsd !== null && subtotal < promo.minSubtotalUsd) {
    return reject(code, 'BELOW_MINIMUM');
  }

  // --- Discount arithmetic -------------------------------------------------
  let discountUsd = 0;
  if (promo.kind === 'PERCENT') {
    discountUsd = round2(subtotal * (promo.percentOff as number));
  } else if (promo.kind === 'FIXED') {
    discountUsd = round2(Math.min(promo.amountOffUsd as number, subtotal));
  }

  // A discount can never exceed the goods value. Clamping here rather than
  // trusting the caller means a $500-off code on a $60 basket yields a $0 order
  // rather than a negative one — which would flow into the tax engine and
  // produce a negative duty, a number no carrier will accept.
  discountUsd = round2(Math.min(Math.max(discountUsd, 0), subtotal));

  const discountedGoodsUsd = round2(subtotal - discountUsd);

  return {
    ok: true,
    code,
    discountUsd,
    freeShipping: promo.kind === 'FREE_SHIPPING',
    discountedGoodsUsd,
  };
}

export interface PromoAppliedTotals {
  /** Goods after discount, USD. */
  goodsUsd: number;
  discountUsd: number;
  /** Duty + tax + shipping + handling, USD. */
  chargesUsd: number;
  /** What the shopper pays, USD. */
  totalUsd: number;
  landed: LandedCostBreakdown;
}

/**
 * Apply a discount and recompute the landed cost on the discounted value.
 *
 * The order of operations is the whole point. Duty and import VAT are a
 * function of the DECLARED value, so they must be recomputed after the discount
 * rather than subtracted from a pre-discount total. Doing it the other way
 * round under-charges duty on every discounted order — a systematic margin leak
 * that only surfaces in an audit.
 */
export function applyPromo(
  ctx: PromoContext,
): { ok: true; totals: PromoAppliedTotals } | { ok: false; verdict: PromoVerdict } {
  const verdict = evaluatePromo(ctx);
  if (!verdict.ok) return { ok: false, verdict };

  const landed = calculateLandedCost(verdict.discountedGoodsUsd, ctx.destinationCountry);

  // Free shipping zeroes the courier line only. Handling is a real per-parcel
  // cost we carry, and waiving it too is how "free shipping" quietly becomes a
  // loss leader on a $12 kurta.
  const shippingUsd = verdict.freeShipping ? 0 : landed.shippingUsd;

  const chargesUsd = round2(landed.dutyUsd + landed.taxUsd + shippingUsd + landed.handlingUsd);
  const totalUsd = round2(verdict.discountedGoodsUsd + chargesUsd);

  return {
    ok: true,
    totals: {
      goodsUsd: verdict.discountedGoodsUsd,
      discountUsd: verdict.discountUsd,
      chargesUsd,
      totalUsd,
      landed: { ...landed, shippingUsd, totalUsd },
    },
  };
}