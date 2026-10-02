/**
 * POST /api/checkout/create-intent — creates (or re-attaches) the Stripe
 * PaymentIntent for an order.
 *
 * Idempotent by design: a shopper who reloads the payment page must get the
 * SAME intent back, never a second one. Two intents for one order is the
 * classic double-charge shape, and the unique constraint on
 * `Order.stripePaymentIntentId` exists to make it impossible.
 *
 * Authorisation. The spec for this endpoint was `{ orderId }` with no ownership
 * check, which would let any signed-in shopper attach a payment intent to
 * somebody else's order — and, since order ids are enumerable in practice,
 * probe another customer's basket, total and currency. So:
 *
 *   - signed in  -> the order must belong to that session
 *   - guest      -> must present the one-time checkoutToken minted at creation
 *
 * Both failures return 404, not 403: distinguishing "no such order" from "not
 * yours" is itself an enumeration oracle.
 *
 * The amount ALWAYS comes from the persisted order, never from the request. A
 * client-supplied amount is a client-supplied price.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { stripeClient, stripeConfigured } from '@/lib/stripe';
import { hashCheckoutToken } from '@/lib/checkout-token';
import { isCurrencyCode, minimumChargeMinorUnits, stripeCurrencyCode, toMinorUnits } from '@/lib/currency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateIntentRequest {
  orderId?: string;
  checkoutToken?: string;
}

const MAX_IDEMPOTENCY_KEY_LEN = 128;
export async function POST(request: Request) {
  let body: CreateIntentRequest;
  try {
    body = (await request.json()) as CreateIntentRequest;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId || orderId.length > 64) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const token = typeof body.checkoutToken === 'string' ? body.checkoutToken : '';

  // Authorisation lives in the `where`, so an unauthorised caller simply does
  // not match a row. There is nothing to leak.
  //
  // Wrapped so an unreachable database returns a retryable 503 rather than an
  // unhandled 500 leaking a Prisma stack trace to a shopper at checkout.
  let order;
  try {
    order = await prisma.order.findFirst({
      where: {
        id: orderId,
        ...(userId
          ? { userId }
          : token
            ? { checkoutTokenHash: hashCheckoutToken(token) }
            : { id: '__no_authorisation__' }),
      },
      select: {
        id: true,
        reference: true,
        status: true,
        currency: true,
        totalLocal: true,
        stripePaymentIntentId: true,
        idempotencyKey: true,
        destinationCountry: true,
      },
    });
  } catch (err) {
    console.error('[stripe] could not load order', err);
    return NextResponse.json(
      { error: 'Could not reach the order store. Please try again.' },
      { status: 503 },
    );
  }

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  if (order.status !== 'PENDING_PAYMENT') {
    // Safe to be specific: the caller already proved ownership above.
    return NextResponse.json(
      { error: `This order is ${order.status.toLowerCase().replace('_', ' ')} and cannot be paid.` },
      { status: 409 },
    );
  }

  if (!isCurrencyCode(order.currency)) {
    return NextResponse.json({ error: `Unsupported order currency ${order.currency}` }, { status: 422 });
  }

  // Derived from the STORED total. Client input is never consulted for money.
  const amountMinor = toMinorUnits(order.totalLocal.toNumber(), order.currency);
  const currency = stripeCurrencyCode(order.currency);

  const minimum = minimumChargeMinorUnits(currency);
  if (amountMinor < minimum) {
    return NextResponse.json(
      { error: `Order total is below the ${currency} minimum charge.` },
      { status: 422 },
    );
  }

  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not configured on this deployment.' },
      { status: 503 },
    );
  }

  const stripe = stripeClient();

  // --- Reuse an existing intent --------------------------------------------
  // Reload, abandon, or double-submit must all land on the same intent.
  if (order.stripePaymentIntentId) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
      if (existing.client_secret) {
        return NextResponse.json({
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
          amountMinor: existing.amount,
          currency: existing.currency,
          reused: true,
        });
      }
    } catch (err) {
      // A missing intent means the row is stale (e.g. the test key was swapped).
      // Log and fall through to creating a replacement rather than stranding a
      // shopper who is trying to pay.
      console.error('[stripe] could not retrieve existing intent', err);
    }
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: amountMinor,
      currency,
      // Lets Stripe offer KakaoPay, Klarna, local cards and wallets based on the
      // customer's country, without us maintaining that list.
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.id,
        orderReference: order.reference,
        // So a Stripe-side retry can be correlated with our order even if our
        // own row is lost.
        idempotencyKey: (order.idempotencyKey ?? '').slice(0, MAX_IDEMPOTENCY_KEY_LEN),
        destinationCountry: order.destinationCountry,
      },
    },
    // Stripe-level idempotency: if we create an intent and then crash before
    // saving the id, the retry returns the SAME intent instead of letting the
    // shopper be charged twice.
    order.idempotencyKey ? { idempotencyKey: `pi_${order.idempotencyKey}`.slice(0, 255) } : undefined,
  );

  if (!intent.client_secret) {
    return NextResponse.json({ error: 'Stripe did not return a client secret.' }, { status: 502 });
  }

  // Lost-update guard: only fill the id in if it is still empty, so two
  // concurrent requests cannot overwrite each other with two different intents.
  await prisma.order.updateMany({
    where: { id: order.id, stripePaymentIntentId: null },
    data: { stripePaymentIntentId: intent.id },
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amountMinor: intent.amount,
    currency: intent.currency,
    reused: false,
  });
}