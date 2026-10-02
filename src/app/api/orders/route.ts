/**
 * POST /api/orders — creates a PENDING_PAYMENT order, linked to the account if
 * there is one.
 *
 * Deliberately does NOT charge a card: Stripe comes next (Phase 3). What this
 * does is create the order the webhook later completes, so inventory decrement
 * and supplier dispatch can be exercised end to end from the UI.
 *
 * Money handling: the client sends USD base amounts plus the rate it displayed.
 * We re-derive the local totals server-side from that rate — never trust a
 * client-computed total.
 *
 * Ordering matters here. Linking to the session BEFORE payment capture is what
 * lets the Stripe webhook transition a cleanly owned order the instant the
 * intent succeeds. Capture first and you are left reconciling orphan guest
 * orders against a customer who is already asking where their order went.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { calculateLandedCost } from '@/lib/duties';
import { isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import { CATALOG } from '@/lib/catalog';
import { auth } from '@/lib/auth';
import { buildFittingSnapshot } from '@/lib/fitting-snapshot';
import { clampBodyParams, type BodyParams } from '@/lib/sizing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_IDEMPOTENCY_KEY_LEN = 128;

interface OrderRequest {
  lines: { slug: string; size: string; quantity: number; priceUsd: number }[];
  destinationCountry: string | null;
  currency: string;
  fxRate: number;
  paymentProvider?: string;
  amountMinor?: number;
  email?: string;
  shipping?: { name?: string; address?: string; city?: string; postcode?: string };
  /**
   * Stable across retries of ONE checkout attempt. A double-clicked "Place
   * order" sends the same key twice and gets the same order back, instead of
   * two orders and two charges.
   */
  idempotencyKey?: string;
  /** Avatar to freeze into the order's fitting snapshot. */
  avatarId?: string;
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

  // --- Session linking -----------------------------------------------------
  // userId comes from the SESSION and never from the body. A client-supplied
  // userId would be an IDOR: anyone could write orders into anyone's history.
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Guest checkout is allowed, but an order with no owner AND no email could
  // never be delivered, refunded, or recovered — so require one of the two.
  const submittedEmail = String(body.email ?? '').trim().toLowerCase();
  if (submittedEmail && submittedEmail.length > 254) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (submittedEmail && !EMAIL_RE.test(submittedEmail)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (!userId && !submittedEmail) {
    return NextResponse.json(
      { error: 'Sign in, or provide an email address for order updates.' },
      { status: 400 },
    );
  }

  // Validate quantities and prices. We re-price from the catalog rather than
  // trusting the client's priceUsd, so a tampered cart cannot change a total.
  let subtotalUsd = 0;
  const resolved: {
    productId: string;
    slug: string;
    title: string;
    variantLabel: string;
    quantity: number;
    priceUsd: number;
  }[] = [];

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
    resolved.push({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      variantLabel: size,
      quantity,
      priceUsd: product.priceUsd,
    });
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

  // --- Idempotency ---------------------------------------------------------
  // A double-clicked "Place order", or a client retrying a request whose
  // response it never saw, must not produce a second order. The client holds
  // one key per checkout ATTEMPT and reuses it on every retry of that attempt.
  const rawKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const idempotencyKey = rawKey ? rawKey.slice(0, MAX_IDEMPOTENCY_KEY_LEN) : null;

  // Preflight reads (idempotency replay, then the avatar snapshot).
  //
  // Wrapped deliberately: an unreachable database must degrade to the SAME 503
  // the create below produces, not to an unhandled 500 that leaks a Prisma
  // stack trace to the shopper.
  //
  // Note this cannot fail OPEN in a way that matters: if the read throws, the
  // create that follows would throw too, so there is no path where we skip the
  // dedupe check and still successfully write a duplicate order.
  let fittingSnapshot: ReturnType<typeof buildFittingSnapshot> | null = null;

  try {
    if (idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey },
        select: { id: true, reference: true, status: true },
      });
      if (existing) {
        // Replay, not an error. The client gets the original order back and the
        // UI stays on the same confirmation screen instead of showing a failure.
        return NextResponse.json({
          reference: existing.reference,
          orderId: existing.id,
          status: existing.status,
          persisted: true,
          replayed: true,
        });
      }
    }

    // --- Fitting snapshot --------------------------------------------------
    // Best-effort: a missing avatar must not block checkout. Resolved by
    // (id, userId) so a signed-in shopper cannot snapshot someone else's body
    // by guessing an id.
    if (userId) {
      const avatar = await prisma.avatarProfile.findFirst({
        where: { userId, ...(body.avatarId ? { id: body.avatarId } : {}) },
        orderBy: { updatedAt: 'desc' },
      });
      if (avatar) {
        // The avatar columns are nullable in Postgres but optional in
        // BodyParams, so null has to become undefined rather than pass through.
        const params: BodyParams = clampBodyParams({
          gender: avatar.gender,
          heightCm: avatar.heightCm,
          weightKg: avatar.weightKg,
          bustCm: avatar.bustCm ?? undefined,
          chestCm: avatar.chestCm ?? undefined,
          waistCm: avatar.waistCm,
          hipCm: avatar.hipCm,
        });
        fittingSnapshot = buildFittingSnapshot(
          params,
          resolved.map((r) => ({ slug: r.slug, title: r.title, size: r.variantLabel, quantity: r.quantity })),
        );
      }
    }
  } catch (err) {
    console.error('[orders] preflight failed', err);
    return NextResponse.json(
      { error: 'Could not reach the order store. Please try again.' },
      { status: 503 },
    );
  }

  try {
    const order = await prisma.order.create({
      data: {
        reference,
        status: 'PENDING_PAYMENT',
        userId,
        // Guests get the submitted email; signed-in shoppers get their account
        // email so a confirmation can reach them either way.
        guestEmail: userId ? null : submittedEmail,
        currency,
        fxRateAtOrder: rate,
        subtotalLocal: toLocal(subtotalUsd),
        dutiesLocal: toLocal(landed.dutyUsd),
        taxLocal: toLocal(landed.taxUsd),
        shippingLocal: toLocal(landed.shippingUsd),
        totalLocal: toLocal(landed.totalUsd),
        destinationCountry: body.destinationCountry ?? 'US',
        paymentProvider: body.paymentProvider,
        idempotencyKey,
        // Prisma's JSON input type wants an index signature; FittingSnapshot is
        // structurally correct but does not declare one. The cast is safe: the
        // object is built by buildFittingSnapshot from primitives, so it does
        // serialise cleanly.
        fittingSnapshot: fittingSnapshot as unknown as Prisma.InputJsonValue | undefined,
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

    return NextResponse.json({
      reference: order.reference,
      orderId: order.id,
      status: order.status,
      persisted: true,
      linkedAccount: !!userId,
      snapshotCaptured: fittingSnapshot !== null,
      totals: {
        subtotalLocal: toLocal(subtotalUsd),
        dutyLocal: toLocal(landed.dutyUsd),
        taxLocal: toLocal(landed.taxUsd),
        shippingLocal: toLocal(landed.shippingUsd),
        totalLocal: toLocal(landed.totalUsd),
        currency,
        fxRate: rate,
      },
    });
  } catch (err) {
    // A unique-violation on idempotencyKey means a concurrent request won the
    // race. That is a success from the shopper's point of view — the order
    // exists — so return it rather than a 500.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      const raced = idempotencyKey
        ? await prisma.order.findUnique({
            where: { idempotencyKey },
            select: { id: true, reference: true, status: true },
          })
        : null;
      if (raced) {
        return NextResponse.json({
          reference: raced.reference,
          orderId: raced.id,
          status: raced.status,
          persisted: true,
          replayed: true,
        });
      }
    }
    // A missing Postgres in dev should not 500 the whole checkout UX.
    console.error('[orders] create failed', err);
    return NextResponse.json(
      { error: 'Could not persist the order. Check DATABASE_URL and run `npm run db:push`.' },
      { status: 503 },
    );
  }
}
