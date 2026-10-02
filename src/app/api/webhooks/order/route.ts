/**
 * POST /api/webhooks/order — INTERNAL / MANUAL order status updates only.
 *
 * DEPRECATED FOR PAYMENT FULFILMENT.
 *
 * This endpoint used to accept `order.created` and `order.paid` and, on receipt,
 * mark the order paid, decrement stock and message the workshops. That is now
 * the exclusive job of POST /api/webhooks/stripe.
 *
 * Why the duplication had to go rather than merely be discouraged: both paths
 * triggered fulfilment on DIFFERENT provider events for the SAME payment. A
 * single customer order could decrement stock twice and send two "prepare this"
 * messages to a karigah. Two implementations of the same state transition will
 * drift, so one of them was deleted.
 *
 * Payment-driven events are now REFUSED with 410 Gone, not quietly ignored — an
 * operator who still has something wired to this endpoint should find out.
 *
 * This endpoint remains for:
 *   - order.refunded
 *   - manual/administrative status corrections
 *
 * It never touches stock and never contacts a supplier. Restocking a returned
 * garment is a deliberate inventory decision, not a side effect of a status
 * flip, and is not automated here.
 */

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OrderEvent {
  id: string;
  type: 'order.created' | 'order.paid' | 'order.refunded' | 'order.status_changed';
  createdAt: string;
  data: {
    orderReference: string;
    destinationCountry: string;
    currency: string;
    fxRate: number;
    items: { skuId: string; quantity: number }[];
    status?: string;
  };
}

/** Events that used to trigger fulfilment here, and must now go to Stripe. */
const PAYMENT_EVENTS = new Set(['order.created', 'order.paid']);

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

  if (PAYMENT_EVENTS.has(event.type)) {
    return NextResponse.json(
      {
        error: `${event.type} is no longer handled here.`,
        useInstead: '/api/webhooks/stripe',
        reason:
          'Payment fulfilment is exclusively the Stripe webhook. Handling it in two places let one order decrement stock twice and alert suppliers twice.',
      },
      { status: 410 },
    );
  }

  if (event.type !== 'order.refunded' && event.type !== 'order.status_changed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  // Validated BEFORE any database work, deliberately.
  //
  // Two reasons. First, security: this endpoint must not be a back door to PAID.
  // The PAID transition belongs to the Stripe webhook alone, which is the entire
  // reason the old fulfilment path was deleted — leaving PAID settable here would
  // recreate the double-counting hole through the side door. Second, an invalid
  // request should be rejected without spending a database round trip.
  const allowed = new Set(['REFUNDED', 'CANCELLED', 'DELIVERED', 'SHIPPED', 'DISPATCHED', 'FULFILLING']);

  const requested = event.type === 'order.refunded' ? 'REFUNDED' : (event.data.status ?? '').toUpperCase();
  if (!allowed.has(requested)) {
    return NextResponse.json(
      {
        error: `status must be one of: ${[...allowed].join(', ')}`,
        note: 'PAID is not settable here. Payment fulfilment is exclusively /api/webhooks/stripe.',
      },
      { status: 400 },
    );
  }
  const target = requested as 'REFUNDED';

  const existingEvent = await prisma.webhookEvent.findUnique({
    where: { providerEventId: event.id },
  });
  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true, eventId: event.id });
  }

  await prisma.webhookEvent.create({
    data: { providerEventId: event.id, type: event.type, payload: event as unknown as object },
  });

  const order = await prisma.order.findUnique({
    where: { reference: event.data.orderReference },
    select: { id: true, reference: true, status: true },
  });

  if (!order) {
    return NextResponse.json({ error: `Unknown order ${event.data.orderReference}` }, { status: 404 });
  }

  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: { not: target } },
    data: { status: target },
  });

  return NextResponse.json({
    received: true,
    eventId: event.id,
    order: order.reference,
    previousStatus: order.status,
    status: target,
    changed: updated.count > 0,
    // Stock and supplier alerts are deliberately NOT touched. If a return needs
    // the units back on the shelf, that is an explicit inventory decision.
    stockAdjusted: false,
    suppliersNotified: false,
  });
}
