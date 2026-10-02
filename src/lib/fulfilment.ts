/**
 * Payment -> fulfilment.
 *
 * This is the ONLY place that transitions an order to PAID and touches stock.
 * Keeping it in one module is what stops the double-counting bug: the Stripe
 * webhook and the legacy internal webhook both call in here, so there is one
 * guarded transition rather than two copies that can drift apart.
 *
 * THE TRANSACTION SPLIT, AND WHY
 * ------------------------------
 * The spec for this work suggested dispatching supplier WhatsApp messages inside
 * the same `prisma.$transaction` that marks the order paid. That is wrong in
 * both directions:
 *
 *   - Send, then roll back -> a karigah has been told to start work on an order
 *     that does not exist and may never exist.
 *   - Commit, then the send fails -> the customer has paid and the workshop was
 *     never told, so the order rots in PENDING_PAYMENT forever.
 *
 * Neither recovers automatically: one wastes a workshop's labour, the other
 * loses a sale.
 *
 * So the transaction records INTENT (status, stock, a DispatchOutbox row) and
 * returns. Messages go out afterwards, best-effort. A failed dispatch leaves the
 * row FAILED for a retry sweep; it never un-pays an order. That is the
 * transactional outbox pattern, and the trade is deliberate: at-least-once
 * notification in exchange for never telling a supplier about a rolled-back
 * order.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { confirmationDeadline, type OrderAlertPayload } from './dispatch';
import { drainOutbox } from './outbox';

export type FulfilmentOutcome =
  | { status: 'fulfilled'; orderId: string; reference: string; stockShortfalls: string[]; alertsQueued: number }
  | { status: 'already_processed'; orderId: string | null; reason: string };

/**
 * Marks a PENDING_PAYMENT order paid, decrements stock and queues supplier
 * alerts — atomically. Delivery happens after this returns, never inside.
 *
 * The conditional `updateMany` on status is the guard: concurrent Stripe
 * retries race on the row lock and exactly one of them sees a row change.
 */
export async function markPaidAndFulfil(matchStripeIntentId: string): Promise<FulfilmentOutcome> {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // --- Guard ---------------------------------------------------------------
    // count === 0 means already paid, cancelled, or no such intent. All three
    // are "nothing to do" and all three must return 200, or Stripe retries an
    // event forever.
    const claimed = await tx.order.updateMany({
      where: { stripePaymentIntentId: matchStripeIntentId, status: 'PENDING_PAYMENT' },
      data: { status: 'PAID', paidAt: now, paymentProvider: 'stripe' },
    });

    if (claimed.count === 0) {
      const existing = await tx.order.findUnique({
        where: { stripePaymentIntentId: matchStripeIntentId },
        select: { id: true, reference: true, status: true },
      });
      return {
        outcome: {
          status: 'already_processed' as const,
          orderId: existing?.id ?? null,
          reason: existing ? `order is ${existing.status}` : 'no order for this payment intent',
        },
      };
    }

    const order = await tx.order.findUnique({
      where: { stripePaymentIntentId: matchStripeIntentId },
      include: { items: true },
    });
    if (!order) {
      // Unreachable in practice: we just updated the row. If it ever happens,
      // throwing rolls the claim back so Stripe's retry can try again.
      throw new Error(`Order vanished while claiming intent ${matchStripeIntentId}`);
    }

    // --- Stock ---------------------------------------------------------------
    // Conditional decrement, so two orders racing for the last unit cannot drive
    // stock negative.
    const stockShortfalls: string[] = [];
    for (const item of order.items) {
      const variant = await tx.productVariant.findFirst({
        where: { productId: item.productId, sizeLabel: item.variantLabel },
        select: { stock: { select: { skuId: true } } },
      });
      if (!variant?.stock) continue;

      const decremented = await tx.inventory.updateMany({
        where: { skuId: variant.stock.skuId, stockLevel: { gte: item.quantity } },
        data: { stockLevel: { decrement: item.quantity } },
      });

      if (decremented.count === 0) {
        // The customer has PAID. We do not refuse to fulfil because the shelf was
        // empty — the money is captured. Record the shortfall so operations can
        // source the piece or refund, rather than pretending we hold stock we do
        // not have.
        stockShortfalls.push(`${item.variantLabel} x${item.quantity}`);
      }
    }

    // --- Notifications: intent only, NOT sent here ---------------------------
    const plans = await buildAlertPlans(order, tx);
    if (plans.length > 0) {
      await tx.dispatchOutbox.createMany({
        data: plans.map((payload) => ({
          orderId: order.id,
          kind: 'ORDER_ALERT',
          payload: payload as unknown as object,
        })),
      });
    }

    return {
      outcome: {
        status: 'fulfilled' as const,
        orderId: order.id,
        reference: order.reference,
        stockShortfalls,
        alertsQueued: plans.length,
      },
    };
  });

  // --- After commit ---------------------------------------------------------
  // Only now, with the transaction committed, is it safe to tell a human being
  // to start sewing. Failure here is not fatal: the row stays PENDING and the
  // outbox worker retries with backoff.
  if (result.outcome.status === 'fulfilled') {
    await drainOutbox(result.outcome.orderId);
  }

  return result.outcome;
}

/**
 * Groups this order's lines by supplier — one alert per workshop, not one per
 * line item. Three messages to one karigah is three interruptions, and the
 * replies stop mapping cleanly to lines.
 */
async function buildAlertPlans(
  order: {
    reference: string;
    destinationCountry: string;
    items: { productId: string; variantLabel: string; quantity: number }[];
  },
  tx: Prisma.TransactionClient,
): Promise<OrderAlertPayload[]> {
  const bySupplier = new Map<string, OrderAlertPayload>();

  for (const item of order.items) {
    const variant = await tx.productVariant.findFirst({
      where: { productId: item.productId, sizeLabel: item.variantLabel },
      include: { stock: { include: { supplier: true } }, product: true },
    });
    const supplier = variant?.stock?.supplier;
    if (!supplier || !variant?.product) continue;

    const entry = bySupplier.get(supplier.id) ?? {
      orderReference: order.reference,
      supplier: {
        supplierName: supplier.name,
        contactName: supplier.contactName,
        whatsappE164: supplier.whatsappE164,
        email: supplier.email,
        city: supplier.city,
        state: supplier.state,
        leadTimeDays: supplier.leadTimeDays,
      },
      lines: [],
      destinationCountry: order.destinationCountry,
      // A third of the supplier's own lead time, floored at 3 days.
      readyBy: confirmationDeadline(supplier.leadTimeDays),
    };

    entry.lines.push({
      title: variant.product.title,
      // The product slug, not Inventory.skuId — that is an internal UUID, and a
      // karigah needs something they can match to a bolt of fabric.
      sku: variant.product.slug,
      size: item.variantLabel,
      quantity: item.quantity,
      fabric: variant.product.fabric,
      originCity: variant.product.originCity,
    });
    bySupplier.set(supplier.id, entry);
  }

  return [...bySupplier.values()];
}

/**
 * Cancels an order whose payment definitively failed.
 *
 * Only ever PENDING_PAYMENT -> CANCELLED. No stock movement, no supplier
 * notification: the goods were never sold, so telling a workshop to prepare them
 * would be actively harmful.
 */
export async function cancelUnpaidOrder(matchStripeIntentId: string): Promise<boolean> {
  const cancelled = await prisma.order.updateMany({
    where: { stripePaymentIntentId: matchStripeIntentId, status: 'PENDING_PAYMENT' },
    data: { status: 'CANCELLED' },
  });
  return cancelled.count > 0;
}
