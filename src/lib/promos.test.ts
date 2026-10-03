/**
 * Promotion-code tests.
 *
 * These cover the rules that cost money when wrong. A discount that is too
 * generous is a margin leak; one that is too tight is a support ticket; a
 * discount that makes duty go negative is an invoice a carrier will reject.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPromo,
  evaluatePromo,
  normalizeCode,
  round2,
  validatePromo,
  type PromoCode,
  type PromoContext,
} from './promos.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

const base = (over: Partial<PromoCode> = {}): PromoCode => ({
  code: 'FIRST10',
  kind: 'PERCENT',
  percentOff: 0.1,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: null,
  maxRedemptions: null,
  perCustomerLimit: null,
  stackable: false,
  appliesToCategories: null,
  ...over,
});

const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({
  promo: base(),
  goodsUsd: 100,
  destinationCountry: 'GB',
  now: NOW,
  ...over,
});

// --- Normalisation ---------------------------------------------------------

test('codes match regardless of case and surrounding whitespace', () => {
  assert.equal(normalizeCode('  first10 '), 'FIRST10');
  assert.equal(normalizeCode('FiRsT10'), 'FIRST10');
});

test('a pasted code with whitespace still validates', () => {
  const v = evaluatePromo(ctx({ promo: base({ code: '  first10 ' }) }));
  assert.equal(v.ok, true);
});

test('dashes inside a code are preserved, not stripped', () => {
  // "FIRST10" and "FIRST-10" must stay distinct codes; conflating them would
  // let one code's rules apply to another code's basket.
  assert.equal(normalizeCode('first-10'), 'FIRST-10');
  assert.notEqual(normalizeCode('first-10'), normalizeCode('first10'));
});

// --- Structural validation -------------------------------------------------

test('a percentage outside (0,1) is malformed, not clamped', () => {
  assert.equal(validatePromo(base({ percentOff: 1.5 }))?.ok, false);
  assert.equal(validatePromo(base({ percentOff: 0 }))?.ok, false);
  assert.equal(validatePromo(base({ percentOff: 1 }))?.ok, false);
});

test('a 100% off code is rejected as a giveaway, not honoured', () => {
  const v = evaluatePromo(ctx({ promo: base({ percentOff: 1 }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'MALFORMED');
});

test('a negative or non-finite fixed amount is malformed', () => {
  assert.equal(validatePromo(base({ kind: 'FIXED', amountOffUsd: -10 }))?.ok, false);
  assert.equal(validatePromo(base({ kind: 'FIXED', amountOffUsd: NaN }))?.ok, false);
  assert.equal(validatePromo(base({ kind: 'FIXED', amountOffUsd: Infinity }))?.ok, false);
});

test('a percent code with no percentage is malformed', () => {
  assert.equal(validatePromo(base({ percentOff: undefined }))?.ok, false);
});

test('an over-long code is rejected', () => {
  assert.equal(validatePromo(base({ code: 'X'.repeat(33) }))?.ok, false);
});

test('non-integer usage limits are malformed', () => {
  assert.equal(validatePromo(base({ perCustomerLimit: 1.5 }))?.ok, false);
  assert.equal(validatePromo(base({ maxRedemptions: 0 }))?.ok, false);
});

test('a well-formed code passes structural validation', () => {
  assert.equal(validatePromo(base()), null);
});

// --- Time window -----------------------------------------------------------

test('a code that has not started is refused', () => {
  const v = evaluatePromo(ctx({ promo: base({ startsAt: new Date('2026-11-01T00:00:00Z') }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'NOT_STARTED');
});

test('a code that has ended is refused', () => {
  const v = evaluatePromo(ctx({ promo: base({ endsAt: new Date('2026-10-01T00:00:00Z') }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'EXPIRED');
});

test('a null end date means no expiry', () => {
  assert.equal(evaluatePromo(ctx({ promo: base({ endsAt: null }) })).ok, true);
});

test('a code is valid at the instant it ends, refused one second after', () => {
// --- Basket rules ----------------------------------------------------------

test('a basket under the minimum is refused', () => {
  const v = evaluatePromo(ctx({ goodsUsd: 50, promo: base({ minSubtotalUsd: 100 }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'BELOW_MINIMUM');
});

test('a basket exactly at the minimum qualifies', () => {
  assert.equal(evaluatePromo(ctx({ goodsUsd: 100, promo: base({ minSubtotalUsd: 100 }) })).ok, true);
});

test('an empty or NaN basket qualifies for nothing', () => {
  for (const goods of [0, -10, NaN]) {
    assert.equal(evaluatePromo(ctx({ goodsUsd: goods })).ok, false, `goodsUsd=${goods}`);
  }
});

test('a non-stackable code is refused when another is applied', () => {
  const v = evaluatePromo(ctx({ promo: base({ stackable: false }), alreadyApplied: ['OTHER'] }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'NOT_STACKABLE');
});

test('a stackable code coexists with another', () => {
  assert.equal(
    evaluatePromo(ctx({ promo: base({ stackable: true }), alreadyApplied: ['OTHER'] })).ok,
    true,
  );
});

test('an empty category list is a misconfiguration, not a match-all', () => {
  const v = evaluatePromo(ctx({ promo: base({ appliesToCategories: [] }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'CATEGORY_EXCLUDED');
});

test('a customer who has used up their allowance is told so', () => {
  const v = evaluatePromo(ctx({ promo: base({ perCustomerLimit: 1 }), customerRedemptions: 1 }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'CUSTOMER_LIMIT');
});

test('the usage limit is reported over the minimum spend', () => {
  // A shopper who has exhausted the code cannot fix it by spending more, so it
  // is the more useful of the two messages to show first.
  const v = evaluatePromo(
    ctx({ promo: base({ perCustomerLimit: 1, minSubtotalUsd: 5000 }), goodsUsd: 10, customerRedemptions: 1 }),
  );
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'CUSTOMER_LIMIT');
});

// --- Discount arithmetic ---------------------------------------------------

test('a percentage discount reduces the goods value exactly', () => {
  const v = evaluatePromo(ctx({ goodsUsd: 100, promo: base({ percentOff: 0.1 }) }));
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.discountUsd, 10);
    assert.equal(v.discountedGoodsUsd, 90);
  }
});

test('a fixed discount larger than the basket clamps to the basket', () => {
  // Otherwise the order goes negative and duty is computed on a negative base.
  const v = evaluatePromo(ctx({ goodsUsd: 60, promo: base({ kind: 'FIXED', amountOffUsd: 500 }) }));
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.discountUsd, 60);
    assert.equal(v.discountedGoodsUsd, 0);
  }
});

test('a fully-discounted basket has zero goods and never negative duty', () => {
  const r = applyPromo(ctx({ goodsUsd: 20, promo: base({ kind: 'FIXED', amountOffUsd: 20 }) }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.totals.goodsUsd, 0);
    assert.equal(r.totals.landed.dutyUsd, 0);
// --- Landed cost interaction ----------------------------------------------

test('duty is charged on the DISCOUNTED value, not the full price', () => {
  // GB is 12% duty above de minimis. Discounting the goods lowers the declared
  // value, so duty must fall too — this is the margin-leak case.
  const half = applyPromo(
    ctx({ goodsUsd: 1000, promo: base({ percentOff: 0.5 }), destinationCountry: 'GB' }),
  );
  assert.equal(half.ok, true);
  if (half.ok) {
    assert.equal(half.totals.goodsUsd, 500);
    assert.equal(half.totals.landed.dutyUsd, 60); // 12% of 500
  }
});

test('free shipping zeroes the courier but not the handling fee', () => {
  const r = applyPromo(ctx({ promo: base({ kind: 'FREE_SHIPPING' }), destinationCountry: 'GB' }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.totals.landed.shippingUsd, 0);
    assert.ok(r.totals.landed.handlingUsd > 0);
  }
});

test('a free-shipping code applies no goods discount', () => {
  const r = applyPromo(ctx({ promo: base({ kind: 'FREE_SHIPPING' }) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.totals.discountUsd, 0);
});

test('a paid code still pays shipping', () => {
  const r = applyPromo(ctx({ promo: base({ percentOff: 0.1 }) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.totals.landed.shippingUsd > 0);
});

test('the total always equals goods plus charges', () => {
  const r = applyPromo(ctx({ goodsUsd: 240.5, promo: base({ percentOff: 0.2 }) }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.totals.totalUsd, round2(r.totals.goodsUsd + r.totals.chargesUsd));
});

test('a domestic order is taxed on the discounted goods, never de-minimised', () => {
  const r = applyPromo(
    ctx({ goodsUsd: 1000, promo: base({ percentOff: 0.5 }), destinationCountry: 'IN' }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    // India is domestic: 5% GST on the discounted 500, and no duty at all.
    assert.equal(r.totals.landed.dutyUsd, 0);
    assert.equal(r.totals.landed.taxUsd, 25);
    assert.equal(r.totals.landed.deMinimisApplied, false);
  }
});

test('a rejected code returns the verdict rather than throwing', () => {
  const r = applyPromo(ctx({ promo: base({ percentOff: 2 }) }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.verdict.ok, false);
    if (!r.verdict.ok) assert.equal(r.verdict.reason, 'MALFORMED');
  }
});

test('every rejection carries a message a shopper can act on', () => {
  const v = evaluatePromo(ctx({ promo: base({ percentOff: -1 }) }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.ok(v.message.length > 0);
});
    assert.equal(r.totals.landed.taxUsd, 0);
    // Only the carriage survives: a free order still costs us postage.
    assert.ok(r.totals.totalUsd > 0);
  }
});

test('discounts round to whole cents', () => {
  // 33.33 * 30% = 9.999, which must not leak a third decimal into an invoice.
  const v = evaluatePromo(ctx({ goodsUsd: 33.33, promo: base({ percentOff: 0.3 }) }));
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.discountUsd, 10);
    assert.equal(round2(v.discountUsd), v.discountUsd);
  }
});

test('every computed money value is already rounded', () => {
  const r = applyPromo(ctx({ goodsUsd: 77.77, promo: base({ percentOff: 0.15 }) }));
  assert.equal(r.ok, true);
  if (r.ok) {
    for (const v of [r.totals.goodsUsd, r.totals.discountUsd, r.totals.chargesUsd, r.totals.totalUsd]) {
      assert.equal(round2(v), v);
    }
  }
});
  const endsAt = new Date('2026-10-10T12:00:00Z');
  assert.equal(evaluatePromo(ctx({ promo: base({ endsAt }), now: endsAt })).ok, true);
  const after = evaluatePromo(ctx({ promo: base({ endsAt }), now: new Date('2026-10-10T12:00:01Z') }));
  assert.equal(after.ok, false);
});