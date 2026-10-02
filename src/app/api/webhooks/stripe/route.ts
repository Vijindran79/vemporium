/**
 * POST /api/webhooks/stripe — the ONLY path that marks an order paid.
 *
 * Handling rules, each of which exists because getting it wrong costs money:
 *
 * 1. RAW BODY. Stripe signs the exact bytes it sent. `request.json()` re-serialises
 *    and the signature check fails for reasons that look like tampering. We use
 *    the text body and hand it to Stripe's verifier.
 * 2. SIGNATURE BEFORE PARSING. `constructEvent` verifies the HMAC against
 *    STRIPE_WEBHOOK_SECRET. We never act on an unverified payload.
 * 3. STRICT EVENT FILTER. Only `payment_intent.succeeded` may fulfil an order.
 *    Listening to `charge.succeeded` as well is precisely the double-counting
 *    bug this endpoint exists to prevent — one payment, two fulfilment events.
 * 4. ALWAYS 200 ONCE VERIFIED. Stripe retries anything non-2xx for days. A
 *    permanent 4xx here means an unpayable order the customer cannot fix;
 *    "already processed" must be a 200, not an error.
 * 5. NOTIFICATIONS ARE NOT IN THE TRANSACTION. See src/lib/fulfilment.ts.
 *
 * `payment_intent.payment_failed` IS handled, and is the one deliberate
 * deviation from a strict "succeeded only" filter: without it a shopper who
 * abandons checkout leaves the order PENDING_PAYMENT forever, holding the
 * reference number and cluttering the queue. It only ever cancels, never
 * fulfils, so it cannot cause a double fulfilment.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { stripeClient, stripeWebhookSecret } from '@/lib/stripe';
import { markPaidAndFulfil, cancelUnpaidOrder } from '@/lib/fulfilment';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Events that may change order state. Everything else is acknowledged and ignored. */
const FULFIL_EVENT = 'payment_intent.succeeded';
const CANCEL_EVENT = 'payment_intent.payment_failed';

export async function POST(request: Request) {
  const secret = stripeWebhookSecret();

  // No dev-mode "accept anything" fallback here, unlike the legacy internal
  // webhook. An unauthenticated payment webhook is a free order-press: anyone
  // who can POST to this URL could mark any basket paid.
  if (!secret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set — refusing all webhook deliveries');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  // Raw text, NOT request.json(): the signature covers the exact bytes.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    // Deliberately vague to the caller: a detailed reason helps an attacker tune
    // a forgery attempt. The detail goes to our logs, not to the response.
    console.warn('[stripe] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // --- Strict filter ---------------------------------------------------------
  if (event.type !== FULFIL_EVENT && event.type !== CANCEL_EVENT) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const intent = event.data.object as Stripe.PaymentIntent;

  // Never trust metadata for the amount or currency — we re-read the order.
  // Metadata is only used to correlate when the intent id is unknown.
  if (!intent?.id) {
    return NextResponse.json({ received: true, ignored: 'no intent id' });
  }

  // --- Ledger ----------------------------------------------------------------
  // Recorded for disputes and reconciliation. NOT the idempotency guard — the
  // conditional update on Order.status is, because a ledger row can be written
  // before the work completes, whereas the status transition cannot.
  try {
    await prisma.webhookEvent.create({
      data: { providerEventId: event.id, type: event.type, payload: event as unknown as object },
    });
  } catch {
    // Unique violation = we have seen this event id before. Continue anyway: the
    // order-status guard below is authoritative, and Stripe may legitimately
    // redeliver after a partial failure.
  }

  if (event.type === CANCEL_EVENT) {
    const cancelled = await cancelUnpaidOrder(intent.id);
    return NextResponse.json({ received: true, cancelled });
  }

  try {
    const outcome = await markPaidAndFulfil(intent.id);

    if (outcome.status === 'already_processed') {
      // 200, always. Stripe must stop retrying.
      return NextResponse.json({ received: true, ...outcome });
    }

    if (outcome.stockShortfalls.length > 0) {
      // Paid, but we do not hold enough stock. Operations needs to know; the
      // order stays PAID because the money is captured.
      console.error(
        `[stripe] ${outcome.reference} paid with insufficient stock:`,
        outcome.stockShortfalls.join(', '),
      );
    }

    return NextResponse.json({ received: true, ...outcome });
  } catch (err) {
    // A genuine transient failure (DB down). 500 makes Stripe retry, which is
    // what we want — the guard makes the retry safe.
    console.error('[stripe] fulfilment failed', err);
    return NextResponse.json({ error: 'Could not process payment' }, { status: 500 });
  }
}