/**
 * GET /api/orders/[id] — order summary and live fulfilment status.
 *
 * Backs the confirmation screen. Authorisation is identical to
 * /api/checkout/create-intent (lib/order-access), so "can I pay for this order"
 * and "can I look at this order" are answered by the same rule. An unauthorised
 * caller gets 404, indistinguishable from a missing order.
 *
 * Note the response deliberately excludes the guest email and the raw
 * fittingSnapshot internals. The screen shows measurements to the person who
 * bought the garment and to nobody else, but there is no reason to hand out the
 * full body record over a polling endpoint that a browser will hit repeatedly.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { orderAccessWhere, checkoutTokenFromRequest } from '@/lib/order-access';
import { isFittingSnapshot } from '@/lib/fitting-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const token = checkoutTokenFromRequest(request);

  let order;
  try {
    order = await prisma.order.findFirst({
      where: orderAccessWhere(id, userId, token),
      select: {
        id: true,
        reference: true,
        status: true,
        currency: true,
        subtotalLocal: true,
        dutiesLocal: true,
        taxLocal: true,
        shippingLocal: true,
        totalLocal: true,
        destinationCountry: true,
        paidAt: true,
        createdAt: true,
        fittingSnapshot: true,
        items: {
          select: { quantity: true, variantLabel: true, lineTotalLocal: true, product: { select: { title: true } } },
        },
      },
    });
  } catch (err) {
    console.error('[orders] could not load order', err);
    return NextResponse.json({ error: 'Could not reach the order store.' }, { status: 503 });
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const snapshot = isFittingSnapshot(order.fittingSnapshot) ? order.fittingSnapshot : null;

  return NextResponse.json({
    order: {
      id: order.id,
      reference: order.reference,
      status: order.status,
      currency: order.currency,
      destinationCountry: order.destinationCountry,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      totals: {
        subtotal: order.subtotalLocal.toString(),
        duties: order.dutiesLocal.toString(),
        tax: order.taxLocal.toString(),
        shipping: order.shippingLocal.toString(),
        total: order.totalLocal.toString(),
      },
      items: order.items.map((i) => ({
        title: i.product.title,
        size: i.variantLabel,
        quantity: i.quantity,
        lineTotal: i.lineTotalLocal.toString(),
      })),
      // The body as it stood at purchase, not as it stands now.
      fittingSnapshot: snapshot
        ? { capturedAt: snapshot.capturedAt, body: snapshot.body }
        : null,
    },
  });
}