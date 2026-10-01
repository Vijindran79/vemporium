/**
 * POST /api/orders — creates a PENDING_PAYMENT order.
 *
 * Deliberately does NOT charge a card: no payment provider is wired up yet
 * (Phase 2). What it does do is create the order the webhook later completes,
 * so the inventory decrement and supplier dispatch pipeline can be exercised
 * end to end from the UI rather than only by hand-crafting a webhook payload.
 *
 * Money handling: the client sends USD base amounts plus the rate it displayed.
 * We re-derive the local totals server-side from that rate — never trust a
 * client-computed total.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { calculateLandedCost } from '@/lib/duties';
import { isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import { CATALOG } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OrderRequest {
  lines: { slug: string; size: string; quantity: number; priceUsd: number }[];
  destinationCountry: string | null;
  currency: string;
  fxRate: number;
  paymentProvider?: string;
  amountMinor?: number;
  email?: string;
  shipping?: { name?: string; address?: string; city?: string; postcode?: string };
}

export async function POST(request: Request) {
  let body: OrderRequest;
  try {
    body = (await request.json()) as OrderRequest;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }
  if (body.lines.length > 50) {
    return NextResponse.json({ error: 'Too many line items' }, { status: 400 });
  }

  // Validate quantities and prices. We re-price from the catalog rather than
  // trusting the client's priceUsd, so a tampered cart cannot change a total.
  let subtotalUsd = 0;
  const resolved: { productId: string; variantLabel: string; quantity: number; priceUsd: number }[] = [];

  for (const line of body.lines) {
    const product = CATALOG.find((p) => p.slug === line.slug);
    if (!product) return NextResponse.json({ error: `Unknown product ${line.slug}` }, { status: 400 });

    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: `Invalid quantity for ${line.slug}` }, { status: 400 });
    }
    const size = String(line.size ?? '').trim().toUpperCase();
    if (!/^(XS|S|M|L|XL|XXL|CUSTOM)$/.test(size)) {
      return NextResponse.json({ error: `Invalid size for ${line.slug}` }, { status: 400 });
    }

    // Server-side price is authoritative.
    subtotalUsd += product.priceUsd * quantity;
    resolved.push({ productId: product.id, variantLabel: size, quantity, priceUsd: product.priceUsd });
  }

  const landed = calculateLandedCost(subtotalUsd, body.destinationCountry);
  const currency: CurrencyCode = isCurrencyCode(body.currency) ? body.currency : 'USD';
  const rate = Number.isFinite(body.fxRate) && body.fxRate > 0 ? body.fxRate : 1;
  const toLocal = (usd: number) => Math.round(usd * rate * 100) / 100;

  // Without a database we cannot persist, but the caller still needs a
  // reference to follow. Returning a generated reference is honest: the UI
  // says the order is pending, and there is genuinely no record yet.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      reference: `DEMO-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'PENDING_PAYMENT',
      persisted: false,
      totals: {
        subtotalLocal: toLocal(subtotalUsd),
        dutyLocal: toLocal(landed.dutyUsd),
        taxLocal: toLocal(landed.taxUsd),
        shippingLocal: toLocal(landed.shippingUsd),
        totalLocal: toLocal(landed.totalUsd),
        currency,
        fxRate: rate,
      },
      note: 'DATABASE_URL is not configured, so the order was not persisted. The webhook pipeline still applies once a database is present.',
    });
  }

  const reference = `ORD-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;

  try {
    const order = await prisma.order.create({
      data: {
        reference,
        status: 'PENDING_PAYMENT',
        currency,
        fxRateAtOrder: rate,
        subtotalLocal: toLocal(subtotalUsd),
        dutiesLocal: toLocal(landed.dutyUsd),
        taxLocal: toLocal(landed.taxUsd),
        shippingLocal: toLocal(landed.shippingUsd),
        totalLocal: toLocal(landed.totalUsd),
        destinationCountry: body.destinationCountry ?? 'US',
        paymentProvider: body.paymentProvider,
        items: {
          create: resolved.map((r) => ({
            productId: r.productId,
            variantLabel: r.variantLabel,
            quantity: r.quantity,
            unitPriceLocal: toLocal(r.priceUsd),
            lineTotalLocal: toLocal(r.priceUsd * r.quantity),
          })),
        },
      },
    });

    return NextResponse.json({ reference: order.reference, status: order.status, persisted: true });
  } catch (err) {
    // A missing Postgres in dev should not 500 the whole checkout UX.
    console.error('[orders] create failed', err);
    return NextResponse.json(
      { error: 'Could not persist the order. Check DATABASE_URL and run `npm run db:push`.' },
      { status: 503 },
    );
  }
}
