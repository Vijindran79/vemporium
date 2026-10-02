'use client';

/**
 * Stripe PaymentElement step.
 *
 * `<PaymentElement/>` renders whatever methods Stripe has enabled for the
 * PaymentIntent — cards, KakaoPay, Klarna, wallets — localised to the shopper.
 * We do not maintain that list; we pass it a client secret and let Stripe
 * decide, which is also why `redirect` matters below.
 *
 * The important subtlety: for card payments `redirect: 'if_required'` resolves
 * IN PLACE, so there is no page navigation and we can show the result directly.
 * For redirect-based methods (KakaoPay, Klarna) the browser leaves for the
 * provider and comes back to return_url, and the webhook may not have fired yet
 * by then — which is why the confirmation screen polls rather than trusting what
 * it finds on arrival.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { getStripe, stripePublishableKeyPresent } from '@/lib/stripe-client';

interface Props {
  clientSecret: string;
  orderId: string;
  /** Sends the browser to the confirmation screen once payment resolves. */
  onComplete: () => void;
  onBack: () => void;
}

const APPEARANCE = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#8c1d2f',
    colorBackground: '#ffffff',
    colorText: '#1c1917',
    borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif',
  },
};

/**
 * PaymentElement readiness.
 *
 * Stripe documents `elements.on('ready', ...)` for PaymentElement, but this SDK
 * version's type definitions only declare `'update-end'`. The event is real and
 * fires when the iframe is mounted and submittable; the shipped types lag.
 *
 * A narrow cast at this one call site, rather than removing readiness gating
 * altogether — without it the Pay button is clickable while the form is still
 * mounting, and `confirmPayment` fails with an opaque "element is not ready".
 */
type ReadyCapableElements = {
  on: (event: 'ready', handler: () => void) => void;
  off: (event: 'ready', handler: () => void) => void;
};

export function StripePaymentStep({ clientSecret, orderId, onComplete, onBack }: Props) {
  const stripePromise = useMemo(() => getStripe(), []);

  if (!stripePublishableKeyPresent()) {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>Payments are not configured on this deployment.</strong>
          <p className="mt-1">
            Set <code className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to render the payment
            form. The order has been created and is awaiting payment.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onBack} className="btn-ghost flex-1">Back</button>
          <button type="button" onClick={onComplete} className="btn-primary flex-1">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: APPEARANCE, locale: 'auto' }}>
      <PaymentForm orderId={orderId} onComplete={onComplete} onBack={onBack} />
    </Elements>
  );
}

function PaymentForm({ orderId, onComplete, onBack }: Omit<Props, 'clientSecret'>) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const target = elements as unknown as ReadyCapableElements | null;
    if (!target) return;
    const markReady = () => setReady(true);
    target.on('ready', markReady);
    // A form that mounts already-rendered never fires 'ready', so assume ready
    // once the Elements object exists rather than trapping the shopper behind a
    // permanently disabled button.
    setReady(true);
    return () => target.off('ready', markReady);
  }, [elements]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // No token in this URL, deliberately. A bearer credential in a query
          // string ends up in browser history, Referer headers and access logs.
          // The confirmation screen reads the capability from sessionStorage and
          // sends it as a header instead.
          return_url: `${window.location.origin}/orders/${orderId}/confirmation`,
        },
        // Cards settle in place with no navigation; redirect methods still go
        // to return_url regardless, because the shopper has left for a provider.
        redirect: 'if_required',
      });

      if (confirmError) {
        // Card declines and validation failures land here WITHOUT unmounting, so
        // the shopper keeps their typed details and can correct one field.
        setError(confirmError.message ?? 'Payment could not be completed.');
        return;
      }

      onComplete();
      router.push(`/orders/${orderId}/confirmation`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment could not be completed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-stone-200 p-3">
        <PaymentElement />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onBack} disabled={submitting} className="btn-ghost flex-1">
          Back
        </button>
        <button
          type="submit"
          disabled={!stripe || !ready || submitting}
          aria-busy={submitting}
          className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Processing…' : 'Pay now'}
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-stone-400">
        Card details go straight to Stripe and never touch our servers. The order is confirmed by Stripe's
        signed webhook, not by this page.
      </p>
    </form>
  );
}