/**
 * POST /api/webhooks/order  —  the supply-chain entry point.
 *
 * A payment provider (Stripe today) calls this once a checkout succeeds. It:
 *   1. verifies the webhook signature
 *   2. decrements inventory for every line item
 *   3. evaluates the replenishment rules
 *   4. creates a purchase order and dispatches it to the Indian supplier
 *
 * Two deliberate choices:
 *   - Idempotency. Providers retry aggressively; we key on the event id so a
 *     duplicate delivery can never double-decrement stock.
 *   - Never throws on dispatch failure. The order is already paid; a WhatsApp
 *     outage must not roll it back. The PO stays in DRAFT for the retry sweep.
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { applyMovement, evaluateReorder, nextPurchaseOrderReference, type SkuState } from '@/lib/inventory';
import { confirmationDeadline, dispatchPurchaseOrder, dispatchOrderAlert, type DispatchLine, type DispatchTarget, type OrderAlertLine } from '@/lib/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OrderEvent {
  id: string;
  type: 'order.created' | 'order.paid' | 'order.refunded';
  createdAt: string;
  data: {
    orderReference: string;
    destinationCountry: string;
    currency: string;
    fxRate: number;
    items: { skuId: string; quantity: number }[];
  };
}

/** Constant-time HMAC comparison so the secret cannot be leaked via timing. */
function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.SUPPLIER_DISPATCH_SECRET;
  // With no secret configured, accept anything so the flow is demoable locally.
  // In production a missing secret is a hard failure.
  if (!secret) return process.env.NODE_ENV !== 'production';
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('x-vemporium-signature');

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: OrderEvent;
  try {
    event = JSON.parse(raw) as OrderEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  if (event.type !== 'order.created' && event.type !== 'order.paid') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  // --- idempotency ---------------------------------------------------------
  const existing = await prisma.webhookEvent.findUnique({ where: { providerEventId: event.id } });
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true, eventId: event.id });
  }

  await prisma.webhookEvent.create({
    data: { providerEventId: event.id, type: event.type, payload: event as unknown as object },
  });

  const order = await prisma.order.findUnique({
    where: { reference: event.data.orderReference },
    include: { items: true },
  });

  if (!order) {
    return NextResponse.json({ error: `Unknown order ${event.data.orderReference}` }, { status: 404 });
  }

  if (order.status === 'PENDING_PAYMENT') {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
  }

  // Group this order's lines by supplier: one workshop gets ONE message listing
  // everything it must prepare, not one message per line item.
  const alerts = await buildOrderAlerts(order);

  // Tell the workshops BEFORE doing stock work, so a slow WhatsApp API never
  // delays the decrement that follows it.
  const alertResults = [];
  for (const alert of alerts) {
    const sent = await dispatchOrderAlert(alert);
    alertResults.push({ supplier: alert.supplier.supplierName, lines: alert.lines.length, sent });
  }

  const results: ReorderResult[] = [];

  for (const item of order.items) {
    const variant = await prisma.productVariant.findFirst({
      where: { product: { id: item.productId }, sizeLabel: item.variantLabel },
      include: {
        stock: {
          include: {
            supplier: true,
            purchaseOrders: {
              where: { purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'IN_PRODUCTION'] } } },
            },
          },
        },
      },
    });

    const stock = variant?.stock;
    if (!stock) {
      results.push({ skuId: 'unknown', now: 0, status: 'NO_SKU', reorder: { triggered: false, reason: 'No inventory record for this line item' } });
      continue;
    }

    const sku: SkuState = {
      skuId: stock.skuId,
      productId: item.productId,
      supplierId: stock.supplierId,
      stockLevel: stock.stockLevel,
      reorderThreshold: stock.reorderThreshold,
      reorderQuantity: stock.reorderQuantity,
      status: stock.status,
      openPurchaseOrder: stock.purchaseOrders.length > 0,
    };

    // 1. decrement — online and retail share this row, so a web sale and an
    //    in-store sale can never oversell each other.
    const movement = applyMovement(sku, {
      skuId: sku.skuId,
      delta: -item.quantity,
      channel: 'online',
      reason: `Order ${order.reference}`,
    });

    await prisma.inventory.update({
      where: { skuId: sku.skuId },
      data: { stockLevel: movement.now, status: movement.status },
    });

    const entry: ReorderResult = {
      skuId: sku.skuId,
      now: movement.now,
      status: movement.status,
      reorder: { triggered: false, reason: `Stock healthy (${movement.now} on hand)` },
    };

    // 2. replenishment decision
    if (movement.crossedThreshold || movement.status === 'OUT_OF_STOCK') {
      const decision = evaluateReorder(sku);

      if (decision.shouldReorder && stock.supplier) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        const dispatchLine: DispatchLine = {
          skuId: sku.skuId,
          title: product?.title ?? 'Garment',
          sizeLabel: item.variantLabel,
          colourHex: variant?.colourHex ?? null,
          units: decision.units,
          fabric: product?.fabric ?? 'SILK',
          weave: product?.weave ?? 'HANDLOOM',
          workType: product?.workType ?? 'PLAIN',
          originCity: product?.originCity ?? null,
        };

        // 3. create the PO
        const reference = nextPurchaseOrderReference();
        const deadline = confirmationDeadline(stock.supplier.leadTimeDays);
        const po = await prisma.purchaseOrder.create({
          data: {
            reference,
            supplierId: stock.supplier.id,
            status: 'DRAFT',
            trigger: decision.trigger ?? 'MANUAL',
            units: decision.units,
            fabricSpec: `${dispatchLine.fabric} / ${dispatchLine.weave} / ${dispatchLine.workType}`,
            deliveryDeadline: new Date(deadline),
            lines: { create: { skuId: sku.skuId, quantity: decision.units } },
          },
        });

        // 4. dispatch — failures leave the PO in DRAFT for the retry sweep
        const dispatched = await dispatchPurchaseOrder({
          reference: po.reference,
          supplier: {
            supplierName: stock.supplier.name,
            contactName: stock.supplier.contactName,
            whatsappE164: stock.supplier.whatsappE164,
            email: stock.supplier.email,
            city: stock.supplier.city,
            state: stock.supplier.state,
            leadTimeDays: stock.supplier.leadTimeDays,
          },
          lines: [dispatchLine],
          decision,
          deadline,
        });

        const allOk = dispatched.every((d) => d.ok);
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: allOk ? 'SENT' : 'DRAFT',
            dispatchedVia: dispatched.filter((d) => d.ok).map((d) => d.channel),
            sentAt: allOk ? new Date() : null,
          },
        });

        entry.reorder = { triggered: true, reason: decision.reason, purchaseOrder: reference, dispatch: dispatched };
      } else {
        entry.reorder = { triggered: false, reason: decision.reason };
      }
    }

    results.push(entry);
  }

  return NextResponse.json({ received: true, eventId: event.id, order: order.reference, alerts: alertResults, results });
}

interface ReorderResult {
  skuId: string;
  now: number;
  status: string;
  reorder: {
    triggered: boolean;
    reason: string;
    purchaseOrder?: string;
    dispatch?: { channel: string; ok: boolean; simulated: boolean; detail: string }[];
  };
}

/**
 * Builds one order-alert per supplier involved in this order.
 *
 * Grouping by supplier is the whole point: a karigah who made three items
 * should get ONE WhatsApp message, not three. Three messages is three
 * interruptions, and the replies no longer map to lines.
 */
async function buildOrderAlerts(order: { reference: string; destinationCountry: string; items: { productId: string; variantLabel: string; quantity: number }[] }) {
  const bySupplier = new Map<string, { supplier: DispatchTarget; lines: OrderAlertLine[] }>();

  for (const item of order.items) {
    const variant = await prisma.productVariant.findFirst({
      where: { product: { id: item.productId }, sizeLabel: item.variantLabel },
      include: { stock: { include: { supplier: true } } },
    });
    const supplier = variant?.stock?.supplier;
    if (!supplier) continue;

    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product) continue;

    const entry = bySupplier.get(supplier.id) ?? {
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
    };

    entry.lines.push({
      title: product.title,
      sku: product.slug,
      size: item.variantLabel,
      quantity: item.quantity,
      fabric: product.fabric,
      originCity: product.originCity,
    });
    bySupplier.set(supplier.id, entry);
  }

  return [...bySupplier.values()].map(({ supplier, lines }) => ({
    orderReference: order.reference,
    supplier,
    lines,
    destinationCountry: order.destinationCountry,
    // Ready-by is a third of the supplier's own lead time, floored at 3 days —
    // the same rule the reorder confirmation deadline uses.
    readyBy: confirmationDeadline(supplier.leadTimeDays),
  }));
}
