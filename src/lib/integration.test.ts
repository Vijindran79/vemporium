/**
 * INTEGRATION TESTS — these talk to a real Postgres.
 *
 * The unit suite (business-logic.test.ts) covers pure functions only. That left
 * a real gap: not one line of code that writes to the database had ever run,
 * which is why "compiles and 503s when the DB is down" was the entire standard
 * of proof. These tests exist to close that.
 *
 * Run against a live database:
 *   docker run -d --name vemporium-pg -e POSTGRES_USER=vemporium \
 *     -e POSTGRES_PASSWORD=vemporium -e POSTGRES_DB=vemporium \
 *     -p 55432:5432 postgres:16-alpine
 *   $env:DATABASE_URL='postgresql://vemporium:vemporium@localhost:55432/vemporium'
 *   npm run db:migrate && npm run db:seed && npm run test:integration
 *
 * Assumes the seed has run (suppliers, products, variants, inventory).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// DATABASE_URL must be set in the environment before this module loads (Prisma
// reads it when the client is constructed), hence static imports rather than a
// dynamic import after assigning process.env.
import { prisma } from './db.ts';
import { signUp, signInCredentials, hashPassword } from './auth.ts';
import { buildFittingSnapshot } from './fitting-snapshot.ts';
import { clampBodyParams } from './sizing.ts';
import { markPaidAndFulfil } from './fulfilment.ts';
import { processOutboxBatch, reclaimStaleLocks, LOCK_TIMEOUT_MS } from './outbox.ts';
import { eraseAccount, exportData } from './privacy.ts';
import { newCheckoutToken, hashCheckoutToken } from './checkout-token.ts';
import { orderAccessWhere } from './order-access.ts';


let seq = 0;
const uniq = () => `it-${Date.now().toString(36)}-${seq++}`;

/** A product variant that has inventory and a supplier, straight from the seed. */
async function seededVariant(sizeLabel = 'M') {
  const variant = await prisma.productVariant.findFirst({
    where: { sizeLabel, product: { slug: 'chanderi-saree' } },
    include: { product: true, stock: true },
  });
  assert.ok(variant?.stock, 'seed must provide a variant with inventory');
  return variant as typeof variant & { stock: NonNullable<typeof variant.stock> };
}

async function stockOf(skuId: string): Promise<number> {
  const row = await prisma.inventory.findUnique({ where: { skuId } });
  return row?.stockLevel ?? -1;
}
// ===========================================================================
// Phase 2 — credentials
// ===========================================================================

test('a user can register and then sign in with the right password', async () => {
  const email = `${uniq()}@example.test`;
  const created = await signUp({ email, password: 'correct-horse-battery', name: 'Asha' });
  assert.equal(created.ok, true, `signUp failed: ${created.error}`);

  const row = await prisma.user.findUnique({ where: { email } });
  assert.ok(row?.passwordHash, 'password must be stored as a hash');
  assert.notEqual(row?.passwordHash, 'correct-horse-battery', 'the plaintext must not be persisted');

  const good = await signInCredentials(email, 'correct-horse-battery');
  assert.equal(good.ok, true, 'the correct password must be accepted');
});

test('the wrong password and an unknown account are both rejected identically', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });

  const wrongPassword = await signInCredentials(email, 'wrong-password-here');
  const unknownUser = await signInCredentials(`${uniq()}@example.test`, 'wrong-password-here');

  // Same message, so nothing leaks which addresses are registered.
  assert.equal(wrongPassword.ok, false);
  assert.equal(unknownUser.ok, false);
  assert.equal(wrongPassword.error, unknownUser.error);
});

test('a new user starts at sessionVersion 0', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const row = await prisma.user.findUnique({ where: { email } });
  assert.equal(row?.sessionVersion, 0);
});

test('hashes are salted, so two identical passwords differ on disk', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b, 'bcrypt must salt; identical hashes mean a shared salt');
});

// ===========================================================================
// Phase 3 — order creation and the fitting snapshot
// ===========================================================================

test('an order persists its fitting snapshot as jsonb and returns it intact', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const variant = await seededVariant();

  const body = clampBodyParams({
    gender: 'FEMALE', heightCm: 165.4, weightKg: 58.2,
    bustCm: 88.9, waistCm: 70.1, hipCm: 96.2,
  });

  const order = await prisma.order.create({
    data: {
      reference: `ORD-TEST-${uniq()}`,
      userId: user.id,
      guestEmail: null,
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      fxRateAtOrder: 1,
      subtotalLocal: 100,
      totalLocal: 100,
      destinationCountry: 'US',
      fittingSnapshot: buildFittingSnapshot(
        body,
        [{ slug: variant.product.slug, title: variant.product.title, size: 'M', quantity: 2 }],
      ) as unknown as object,
      items: {
        create: {
          productId: variant.productId,
          variantLabel: 'M',
          quantity: 2,
          unitPriceLocal: 50,
          lineTotalLocal: 100,
        },
      },
    },
  });

  const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const snap = stored.fittingSnapshot as { body: Record<string, unknown> };

  assert.ok(snap, 'the snapshot must survive a jsonb round trip');
  assert.equal(snap.body.heightCm, 165.4);
  assert.equal(snap.body.waistCm, 70.1);
  // Normalised: a missing bust is null, not absent. A JSON column whose field is
  // sometimes missing and sometimes null is a schema nobody can query later.
// ===========================================================================
// Phase 4 — markPaidAndFulfil (the path that has never run)
// ===========================================================================

async function makeOrder(userId: string, quantity = 2) {
  const variant = await seededVariant();
  const token = newCheckoutToken();
  const order = await prisma.order.create({
    data: {
      reference: `ORD-TEST-${uniq()}`,
      userId,
      currency: 'USD', fxRateAtOrder: 1, subtotalLocal: 100, totalLocal: 100,
      destinationCountry: 'US',
      stripePaymentIntentId: `pi_${uniq()}`,
      checkoutTokenHash: hashCheckoutToken(token),
      items: {
        create: {
          productId: variant.productId, variantLabel: 'M', quantity,
          unitPriceLocal: 50, lineTotalLocal: 50 * quantity,
        },
      },
    },
  });
  return { order, variant, token };
}

test('a paid order transitions to PAID, decrements stock, and queues an alert', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const { order, variant } = await makeOrder(user.id, 2);
  const before = await stockOf(variant.stock!.skuId);

  const outcome = await markPaidAndFulfil(order.stripePaymentIntentId!);

  assert.equal(outcome.status, 'fulfilled', `expected fulfilled, got ${JSON.stringify(outcome)}`);

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.status, 'PAID');
  assert.ok(after.paidAt, 'paidAt must be stamped exactly once, in the same transaction');

  const stock = await stockOf(variant.stock!.skuId);
  assert.equal(stock, before - 2, `stock should drop by 2 (${before} -> ${stock})`);

  const queued = await prisma.dispatchOutbox.findMany({ where: { orderId: order.id } });
  assert.equal(queued.length, 1, 'one alert per supplier, not one per line item');
  assert.equal(queued[0].status, 'SENT', 'dispatch is simulated without Twilio creds, so it settles SENT');
});

test('a replayed webhook does not decrement stock or re-alert', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const { order, variant } = await makeOrder(user.id, 2);
  const intent = order.stripePaymentIntentId!;
  const before = await stockOf(variant.stock!.skuId);

  const first = await markPaidAndFulfil(intent);
  const afterFirst = await stockOf(variant.stock!.skuId);

  // Stripe retries. Three more deliveries of the same event.
  for (let i = 0; i < 3; i += 1) await markPaidAndFulfil(intent);
  const afterRetries = await stockOf(variant.stock!.skuId);

  assert.equal(first.status, 'fulfilled');
  assert.equal(afterFirst, before - 2);

  // This is the double-counting bug the whole outbox design exists to prevent.
  assert.equal(afterRetries, afterFirst, 'retries must NOT decrement stock again');

  const alerts = await prisma.dispatchOutbox.count({ where: { orderId: order.id } });
  assert.equal(alerts, 1, 'retries must NOT queue a second supplier alert');
});

test('stock cannot be driven negative by an order larger than on hand', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const variant = await seededVariant();

  // Pin stock low so the decrement cannot be satisfied.
  await prisma.inventory.update({ where: { skuId: variant.stock!.skuId }, data: { stockLevel: 1 } });

  const { order } = await makeOrder(user.id, 5);
  const outcome = await markPaidAndFulfil(order.stripePaymentIntentId!);

  assert.equal(outcome.status, 'fulfilled', 'the customer paid; stock must not block fulfilment');
// ===========================================================================
// Phase 5 — outbox worker: claiming, orphaned locks, dead letters
// ===========================================================================

async function seedOutbox(userId: string, overrides: Record<string, unknown> = {}) {
  const { order } = await makeOrder(userId);
  return prisma.dispatchOutbox.create({
    data: {
      orderId: order.id,
      kind: 'ORDER_ALERT',
      payload: {
        orderReference: order.reference,
        supplier: {
          supplierName: 'Test Workshop', contactName: 'Ravi', whatsappE164: '+919999999999',
          email: null, city: 'Varanasi', state: 'UP', leadTimeDays: 21,
        },
        lines: [{ title: 'Chanderi Silk Saree', sku: 'chanderi-saree', size: 'M', quantity: 1, fabric: 'CHANDERI', originCity: 'Chanderi' }],
        destinationCountry: 'US',
        readyBy: '2026-04-01',
      },
      ...overrides,
    } as never,
  });
}

test('the worker claims due rows once, and a second pass finds nothing', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const row = await seedOutbox(user.id);

  const first = await processOutboxBatch({ workerId: 'w1' });
  assert.ok(first.claimed >= 1, 'the first pass must claim the row');
  assert.ok(first.sent >= 1);

  const settled = await prisma.dispatchOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(settled.status, 'SENT');
  assert.ok(settled.sentAt, 'sentAt is stamped on success');

  // Second pass: SENT is terminal and must never be picked up again.
  const second = await processOutboxBatch({ workerId: 'w2' });
  assert.equal(second.claimed, 0, 'a SENT row must not be re-sent');
});

test('a row that is not yet due is left alone', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const row = await seedOutbox(user.id, { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) });

  await processOutboxBatch({ workerId: 'w1' });

  const after = await prisma.dispatchOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.status, 'PENDING', 'backoff must actually defer the retry');
  assert.equal(after.lockedAt, null, 'a row that was not claimed must hold no lock');
});

test('an orphaned PROCESSING lock is reclaimed, not stranded', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  // Simulate a worker that claimed a row and then died without releasing it.
  const row = await seedOutbox(user.id, {
    status: 'PROCESSING',
    lockedAt: new Date(Date.now() - LOCK_TIMEOUT_MS - 60_000),
    workerId: 'dead-worker',
  });

  const result = await processOutboxBatch({ workerId: 'rescuer' });
  assert.ok(result.reclaimed >= 1, 'a stale lock must be reclaimed');

  const after = await prisma.dispatchOutbox.findUniqueOrThrow({ where: { id: row.id } });
  assert.notEqual(after.status, 'PROCESSING', 'the row must not be left stuck');
});
// ===========================================================================
// Phase 6 — GDPR erasure against real foreign keys
// ===========================================================================

test('erasure re-parents orders to a tombstone and scrubs body data', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  await prisma.avatarProfile.create({
    data: {
      userId: user.id, label: 'default', gender: 'FEMALE',
      heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 70, hipCm: 96,
      skinToneHex: '#c8a27a', hairStyleId: null, hairColorHex: null,
    },
  });

  const variant = await seededVariant();
  const order = await prisma.order.create({
    data: {
      reference: `ORD-TEST-${uniq()}`,
      userId: user.id, guestEmail: email,
      currency: 'USD', fxRateAtOrder: 1, subtotalLocal: 100, totalLocal: 100,
      destinationCountry: 'US',
      fittingSnapshot: buildFittingSnapshot(
        clampBodyParams({ gender: 'FEMALE', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 70, hipCm: 96 }),
        [],
      ) as unknown as object,
      items: { create: { productId: variant.productId, variantLabel: 'M', quantity: 1, unitPriceLocal: 100, lineTotalLocal: 100 } },
    },
  });

  const result = await eraseAccount(user.id);
  assert.equal(result.ok, true, `erasure failed: ${result.error}`);

  // The user and every trace of their body data are gone.
  assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
  assert.equal(await prisma.avatarProfile.count({ where: { userId: user.id } }), 0);

  // The sales record survives, detached, with the body data removed.
  const kept = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.ok(kept.userId, 'the order must be re-parented to a tombstone, not deleted');
  assert.notEqual(kept.userId, user.id);
  assert.equal(kept.fittingSnapshot, null, 'body measurements must NOT outlive erasure');
  assert.equal(kept.guestEmail, null, 'the email must NOT outlive erasure');
  assert.equal(kept.totalLocal.toNumber(), 100, 'the financial record must survive');

  const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: kept.userId! } });
  assert.match(tombstone.email, /^erased\+/, 'the tombstone must not be attributable');
});

test('export returns the data we hold before any erasure', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const exported = await exportData(user.id);
  assert.ok(exported, 'export must return something for a real user');
  assert.equal(exported!.account.email, email);
  assert.match(exported!.retentionNotice, /body measurements removed/);
});

test('erasing a user with no orders does not throw', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const result = await eraseAccount(user.id);
  assert.equal(result.ok, true);
});

test('orderAccessWhere matches a real order for its owner and nobody else', async () => {
  const ownerEmail = `${uniq()}@example.test`;
  const otherEmail = `${uniq()}@example.test`;
  await signUp({ email: ownerEmail, password: 'correct-horse-battery' });
  await signUp({ email: otherEmail, password: 'correct-horse-battery' });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const other = await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
  const { order } = await makeOrder(owner.id);

  const asOwner = await prisma.order.findFirst({ where: orderAccessWhere(order.id, owner.id, null) });
  const asStranger = await prisma.order.findFirst({ where: orderAccessWhere(order.id, other.id, null) });
  const asAnonymous = await prisma.order.findFirst({ where: orderAccessWhere(order.id, null, null) });

  assert.equal(asOwner?.id, order.id, 'the owner must see their order');
  assert.equal(asStranger, null, 'another signed-in user must NOT see it');
  assert.equal(asAnonymous, null, 'an unauthenticated caller must NOT see it');
});


test('a FRESH lock is not stolen from a live worker', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  const row = await seedOutbox(user.id, {
    status: 'PROCESSING',
    lockedAt: new Date(), // just claimed by a worker that is still running
    workerId: 'busy-worker',
  });

  const reclaimed = await reclaimStaleLocks();
  const after = await prisma.dispatchOutbox.findUniqueOrThrow({ where: { id: row.id } });

  assert.equal(after.status, 'PROCESSING', 'a live worker keeps its row');
  assert.equal(after.workerId, 'busy-worker');
  assert.equal(reclaimed, 0, 'nothing should be reclaimed while the lock is fresh');
});

  const stock = await stockOf(variant.stock!.skuId);
  assert.ok(stock >= 0, `stock must never go negative (was ${stock})`);

  const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(row.status, 'PAID', 'a paid order stays PAID even when short on stock');
});

test('an unknown payment intent is a no-op, not a crash', async () => {
  const outcome = await markPaidAndFulfil(`pi_does_not_exist_${uniq()}`);
  assert.equal(outcome.status, 'already_processed');
  assert.equal(outcome.orderId, null);
});
  assert.ok('bustCm' in snap.body);
});

test('the snapshot does NOT follow the profile when measurements change', async () => {
  const email = `${uniq()}@example.test`;
  await signUp({ email, password: 'correct-horse-battery' });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const variant = await seededVariant();

  const order = await prisma.order.create({
    data: {
      reference: `ORD-TEST-${uniq()}`,
      userId: user.id,
      currency: 'USD', fxRateAtOrder: 1, subtotalLocal: 100, totalLocal: 100,
      destinationCountry: 'US',
      fittingSnapshot: buildFittingSnapshot(
        clampBodyParams({ gender: 'FEMALE', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 70, hipCm: 96 }),
        [],
      ) as unknown as object,
      items: { create: { productId: variant.productId, variantLabel: 'M', quantity: 1, unitPriceLocal: 100, lineTotalLocal: 100 } },
    },
  });

  // The shopper updates their profile AFTER buying.
  await prisma.avatarProfile.create({
    data: {
      userId: user.id, label: 'default', gender: 'FEMALE',
      heightCm: 165, weightKg: 74, bustCm: 99, waistCm: 84, hipCm: 106,
      skinToneHex: '#c8a27a', hairStyleId: null, hairColorHex: null,
    },
  });

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const snap = after.fittingSnapshot as { body: { waistCm: number } };
  assert.equal(snap.body.waistCm, 70, 'the historical snapshot must keep the waist at purchase');
});

test.after(async () => {
  await prisma.$disconnect();
});
