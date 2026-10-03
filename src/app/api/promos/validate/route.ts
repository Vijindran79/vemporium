/**
 * POST /api/promos/validate — check a code against a basket.
 *
 * This is ADVISORY ONLY. It powers the inline "Apply" feedback in checkout, and
 * nothing here is trusted when the money is actually taken: /api/orders
 * re-derives the discount from the stored promo on its own. A shopper can forge
 * this response entirely, so treating it as authoritative would be a discount
 * the client grants itself.
 *
 * It exists because "your code is invalid" discovered at the payment step is
 * an abandoned cart, and the same answer discovered while typing is free.
 *
 * Prices are RE-PRICED from the catalog, exactly as in /api/orders. A
 * client-supplied `goodsUsd` would let anyone validate a code against an
 * arbitrary basket — including a £0.01 basket to slip under a £15 minimum.
 */

import { NextResponse } from 'next/server';
import { applyPromo } from '@/lib/promos';
import { CATALOG } from '@/lib/catalog';
import { findPromo, redemptionCount, customerRedemptionCount } from '@/lib/promo-store';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LINES = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_MAX_LEN = 64;

interface ValidateRequest {
  code?: unknown;
  lines?: unknown;
  destinationCountry?: unknown;
  email?: unknown;
  /** Codes already on this basket, for the stackability check. */
  alreadyApplied?: unknown;
}

/** Unknown-code response. Identical whether the code is absent or wrong. */
function invalidCode() {
  return NextResponse.json(
    { ok: false, reason: 'UNKNOWN', message: 'That code is not recognised.' },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  let body: ValidateRequest;
  try {
    body = (await request.json()) as ValidateRequest;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  // --- Code ----------------------------------------------------------------
  const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
  if (!rawCode || rawCode.length > CODE_MAX_LEN) return invalidCode();

  // --- Basket, re-priced server-side ---------------------------------------
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }
  if (body.lines.length > MAX_LINES) {
    return NextResponse.json({ error: 'Too many line items' }, { status: 400 });
  }

  let goodsUsd = 0;
  for (const line of body.lines as Array<Record<string, unknown>>) {
    const slug = typeof line?.slug === 'string' ? line.slug : '';
    const product = CATALOG.find((p) => p.slug === slug);
    if (!product) {
      return NextResponse.json({ error: `Unknown product ${slug}` }, { status: 400 });
    }
    const quantity = Math.floor(Number(line?.quantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: `Invalid quantity for ${slug}` }, { status: 400 });
    }
    goodsUsd += product.priceUsd * quantity;
  }

  const country =
    typeof body.destinationCountry === 'string' ? body.destinationCountry.toUpperCase() : null;
  const now = new Date();

  const promo = await findPromo(rawCode, now);
  // Not found covers both "no such code" and "expired / not yet active",
  // because the window is filtered in SQL. The shopper is told the code is not
  // recognised rather than which half of it was true.
  if (!promo) return invalidCode();

  // --- Usage limits --------------------------------------------------------
  // Reuse an already-applied code from the same basket for the stacking check.
  const alreadyApplied = Array.isArray(body.alreadyApplied)
    ? (body.alreadyApplied as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  const email =
    typeof body.email === 'string' && EMAIL_RE.test(body.email.trim())
      ? body.email.trim().toLowerCase()
      : null;

  // The promo id is needed for the counts. Looked up again because findPromo
  // deliberately returns the rules without internal identifiers.
  const promoId = await promoIdFor(promo.code);
  let redemptions = 0;
  let customerRedemptions = 0;
  if (promoId) {
    [redemptions, customerRedemptions] = await Promise.all([
      redemptionCount(promoId),
      customerRedemptionCount(promoId, userId, email),
    ]);
  }

  const ctx = {
    promo,
    goodsUsd,
    destinationCountry: country,
    now,
    customerRedemptions,
    alreadyApplied: alreadyApplied.filter((c) => c !== promo.code),
  };

  const applied = applyPromo(ctx);

  // maxRedemptions is enforced here rather than in evaluatePromo because it is
  // a GLOBAL count, while the pure module only knows the per-customer number.
  // Overriding an exhausted verdict keeps the message specific to the real
  // problem instead of a generic failure.
  if (applied.ok && promo.maxRedemptions !== null && redemptions >= promo.maxRedemptions) {
    return NextResponse.json({
      ok: false,
      reason: 'EXHAUSTED',
      message: 'That code has been fully redeemed.',
    });
  }

  if (!applied.ok) {
    return NextResponse.json({
      ok: false,
      reason: applied.verdict.ok ? 'UNKNOWN' : applied.verdict.reason,
      message: applied.verdict.ok ? 'That code is not recognised.' : applied.verdict.message,
    });
  }

  return NextResponse.json({
    ok: true,
    code: applied.totals.code,
    // Everything the UI renders, in USD base. The client applies the FX rate for
    // display; it does not get a say in the amounts.
    discountUsd: applied.totals.discountUsd,
    freeShipping: applied.totals.freeShipping,
    totals: {
      goodsUsd: applied.totals.goodsUsd,
      dutyUsd: applied.totals.landed.dutyUsd,
      taxUsd: applied.totals.landed.taxUsd,
      shippingUsd: applied.totals.landed.shippingUsd,
      handlingUsd: applied.totals.landed.handlingUsd,
      totalUsd: applied.totals.totalUsd,
    },
    // Explicitly a PREVIEW: /api/orders recomputes all of this.
    advisory: true,
  });
}

/** Resolve a normalised code back to its row id for the redemption counts. */
async function promoIdFor(code: string): Promise<string | null> {
  try {
    const { prisma } = await import('@/lib/db');
    const row = await prisma.promoCode.findUnique({
      where: { code },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

