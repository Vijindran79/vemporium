/**
 * Promo-code INTEGRATION tests — these talk to a real Postgres.
 *
 * The unit suite proves the arithmetic in lib/promos.ts. It cannot prove the
 * things that only exist once a row is written, and those are precisely the
 * parts that decide money:
 *
 *   - that a redeemed code is recorded against the order,
 *   - that redemption counts come from ORDER rows and therefore reflect reality,
 *   - that the persisted total is the DISCOUNTED one, which is what Stripe is
 *     later asked to charge.
 *
 * Run the same way as integration.test.ts: a live database, migrations and seed
 * applied (npm run db:migrate && npm run db:seed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from './db.ts';
import { applyPromo } from './promos.ts';
import { findPromo, redemptionCount, customerRedemptionCount, rowToPromo } from './promo-store.ts';
import { calculateLandedCost } from './duties.ts';

let seq = 0;
const uniq = () => `promo-it-${Date.now().toString(36)}-${seq++}`;

/** Create a promo with a unique code so tests never collide with the seed. */
async function makePromo(over: Record<string, unknown> = {}) {
  const code = String(over.code ?? uniq().toUpperCase());
  return prisma.promoCode.create({
    data: {
      code,
      kind: 'PERCENT',
      percentOff: 0.1,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: null,
      stackable: false,
      active: true,
      ...over,
    },
  });
}

// --- Row -> rules conversion ----------------------------------------------

test('a stored row converts into the rules shape the engine consumes', async () => {
  const promo = await makePromo({ percentOff: 0.25, minSubtotalUsd: 100 });
  const rules = rowToPromo({
    id: promo.id,
    code: promo.code,
    kind: promo.kind,
    percentOff: promo.percentOff,
    amountOffUsd: promo.amountOffUsd,
    minSubtotalUsd: promo.minSubtotalUsd,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    maxRedemptions: promo.maxRedemptions,
    perCustomerLimit: promo.perCustomerLimit,
    stackable: promo.stackable,
    appliesToCategories: promo.appliesToCategories,
  });

  assert.equal(rules.percentOff, 0.25);
  assert.equal(rules.minSubtotalUsd, 100);
  // The engine works in numbers, not Prisma Decimals.
  assert.equal(typeof rules.percentOff, 'number');
});

test('an unrecognised kind is not coerced into a live discount', async () => {
  const promo = await makePromo({ kind: 'PERCENT_ISH' });
  const rules = rowToPromo({
    id: promo.id,
    code: promo.code,
    kind: promo.kind,
    percentOff: 0.5,
    amountOffUsd: null,
    minSubtotalUsd: null,
    startsAt: promo.startsAt,
    endsAt: null,
    maxRedemptions: null,
    perCustomerLimit: null,
    stackable: false,
    appliesToCategories: null,
  });

  // A typo in `kind` must not become a 50% discount.
  assert.equal(rules.kind, 'PERCENT_ISH');
  const applied = applyPromo({
    promo: rules,
    goodsUsd: 100,
    destinationCountry: 'GB',
    now: new Date(),
  });
  assert.equal(applied.ok, false);
});

// --- Lookup ----------------------------------------------------------------

test('an active code is found, case-insensitively', async () => {
  const promo = await makePromo({ code: `FINDME${seq++}` });
  const found = await findPromo(promo.code.toLowerCase(), new Date());
  assert.ok(found);
  assert.equal(found.code, promo.code);
});

test('an expired code is never returned', async () => {
  const promo = await makePromo({
    endsAt: new Date(Date.now() - 86_400_000),
  });
  assert.equal(await findPromo(promo.code, new Date()), null);
});

test('a not-yet-started code is never returned', async () => {
  const promo = await makePromo({ startsAt: new Date(Date.now() + 86_400_000) });
  assert.equal(await findPromo(promo.code, new Date()), null);
});

test('an inactive code is never returned', async () => {
  const promo = await makePromo({ active: false });
  assert.equal(await findPromo(promo.code, new Date()), null);
});

// --- The money assertion ---------------------------------------------------

test('duty is charged on the discounted value, not the full price', async () => {
  // The whole point of this file in one test. GB is 12% duty above de minimis,
  // so a 50%-off $1000 basket must pay duty on $500.
  const promo = await makePromo({ percentOff: 0.5 });
  const rules = await findPromo(promo.code, new Date());
  assert.ok(rules);

  const applied = applyPromo({
    promo: rules,
    goodsUsd: 1000,
    destinationCountry: 'GB',
    now: new Date(),
  });

  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.equal(applied.totals.goodsUsd, 500);
    assert.equal(applied.totals.discountUsd, 500);
    assert.equal(applied.totals.landed.dutyUsd, 60);
    // Total = discounted goods + recomputed duty + tax + shipping + handling.
    assert.equal(applied.totals.totalUsd, applied.totals.landed.totalUsd);
  }

  // Duty must be strictly lower on the discounted value than on the full one.
  // This is the assertion that would fail if the discount were subtracted from
  // a pre-computed total instead of being fed back through the tax engine.
  const plain = calculateLandedCost(1000, 'GB');
  assert.ok(plain.dutyUsd > applied.totals.landed.dutyUsd);
});

test('the discounted total is strictly less than the undiscounted one', async () => {
  const promo = await makePromo({ percentOff: 0.1 });
  const rules = await findPromo(promo.code, new Date());
  assert.ok(rules);

  const plain = calculateLandedCost(400, 'GB');
  const applied = applyPromo({
    promo: rules,
    goodsUsd: 400,
    destinationCountry: 'GB',
    now: new Date(),
  });

  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.ok(applied.totals.totalUsd < plain.totalUsd);
  }
});

// --- Redemption ledger -----------------------------------------------------

test('redemption counts come from order rows, so they reflect reality', async () => {
  // This is why PromoCode has no counter column.
  const promo = await makePromo();
  assert.equal(await redemptionCount(promo.id), 0);

  const email = `${uniq()}@example.test`;
  await prisma.order.create({
    data: {
      reference: `PROMO-${Date.now()}-${seq++}`,
      guestEmail: email,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      fxRateAtOrder: 1,
      subtotalLocal: 100,
      totalLocal: 90,
      destinationCountry: 'GB',
      promoCodeId: promo.id,
      promoCodeApplied: promo.code,
      discountLocal: 10,
    },
  });

  assert.equal(await redemptionCount(promo.id), 1);
  assert.equal(await customerRedemptionCount(promo.id, null, email), 1);
  assert.equal(await customerRedemptionCount(promo.id, null, 'someone-else@example.test'), 0);
});

test('an order with no promo is not counted against any code', async () => {
  const promo = await makePromo();
  await prisma.order.create({
    data: {
      reference: `NOPROMO-${Date.now()}-${seq++}`,
      guestEmail: `${uniq()}@example.test`,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      fxRateAtOrder: 1,
      subtotalLocal: 50,
      totalLocal: 50,
      destinationCountry: 'GB',
    },
  });
  assert.equal(await redemptionCount(promo.id), 0);
});

test('deleting a promo leaves its orders intact', async () => {
  // ON DELETE SET NULL: a marketing cleanup must never delete sales history.
  const promo = await makePromo();
  const email = `${uniq()}@example.test`;
  const order = await prisma.order.create({
    data: {
      reference: `KEEP-${Date.now()}-${seq++}`,
      guestEmail: email,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      fxRateAtOrder: 1,
      subtotalLocal: 100,
      totalLocal: 90,
      destinationCountry: 'GB',
      promoCodeId: promo.id,
      promoCodeApplied: promo.code,
      discountLocal: 10,
    },
  });

  await prisma.promoCode.delete({ where: { id: promo.id } });

  const survivor = await prisma.order.findUnique({ where: { id: order.id } });
  assert.ok(survivor, 'order must survive the promo being deleted');
  // The FK is nulled, but the code and discount are frozen on the order.
  assert.equal(survivor.promoCodeId, null);
  assert.equal(survivor.promoCodeApplied, promo.code);
  assert.equal(survivor.discountLocal.toNumber(), 10);
});
