'use client';

/**
 * Order confirmation, with live fulfilment status.
 *
 * WHY THIS POLLS
 * --------------
 * The shopper usually arrives here BEFORE our webhook has run. Stripe redirects
 * the browser the instant payment succeeds; the signed webhook is a separate
 * HTTP request that may be seconds behind. So "PENDING_PAYMENT" on arrival is
 * the NORMAL case for a successful payment, not a failure — this screen says so
 * rather than showing a scary error.
 *
 * Polling rather than WebSockets/SSE: this is a serverless Next.js deployment,
 * where long-lived connections are expensive to hold open for one status field.
 * A short backoff poll is the right shape here; SSE only earns its cost with
 * many concurrent viewers per order.
 *
 * Polling STOPS on a terminal status and always stops at the cap — a page left
 * open in a background tab should not hammer the API all evening.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/fx';
import type { CurrencyCode } from '@/lib/currency';
import { readCheckoutToken } from '@/lib/stripe-client';

interface OrderView {
  reference: string;
  status: string;
  currency: CurrencyCode;
  destinationCountry: string;
  paidAt: string | null;
  createdAt: string;
  totals: { subtotal: string; duties: string; tax: string; shipping: string; total: string };
  items: { title: string; size: string; quantity: number; lineTotal: string }[];
  fittingSnapshot: { capturedAt: string; body: Record<string, number | string | null> } | null;
}

/** Statuses that will not change again, so polling can stop. */
const TERMINAL = new Set(['PAID', 'CANCELLED', 'REFUNDED', 'SHIPPED', 'DELIVERED']);

const MAX_POLLS = 40;
const BASE_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 10000;

export default function OrderConfirmation({ orderId }: { orderId: string }) {

  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const polls = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    // Read fresh each poll: the token is written by checkout and lives in
    // sessionStorage, never in this page's URL.
    const token = readCheckoutToken(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        headers: token ? { 'x-checkout-token': token } : {},
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(res.status === 404 ? 'We could not find that order.' : 'Could not load your order.');
        setLoading(false);
        return null;
      }
      const data = await res.json();
      setOrder(data.order as OrderView);
      setError(null);
      setLoading(false);
      return data.order as OrderView;
    } catch {
      setError('Could not load your order.');
      setLoading(false);
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const current = await load();
      polls.current += 1;

      // Stop on terminal, past the cap, or on any error — polling cannot fix a
      // 404, and hammering the endpoint will not make it appear.
      if (cancelled || !current || TERMINAL.has(current.status) || polls.current >= MAX_POLLS) return;

      const delay = Math.min(BASE_INTERVAL_MS * 1.4 ** polls.current, MAX_INTERVAL_MS);
      timer.current = setTimeout(tick, delay);
    }

    void tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

if (loading) {
    return (
      <div className="card mx-auto max-w-2xl p-10 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-maroon" />
        <p className="mt-4 text-sm text-stone-600">Loading your order…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="card mx-auto max-w-2xl p-10 text-center">
        <h1 className="font-display text-2xl text-maroon">Order unavailable</h1>
        <p className="mt-2 text-sm text-stone-600">{error ?? 'Something went wrong.'}</p>
        <p className="mt-3 text-xs text-stone-500">
          If you paid for this order, your card has not been charged twice — contact us with the order
          reference and we will confirm its state.
        </p>
        <Link href="/catalog" className="btn-primary mt-6">Continue shopping</Link>
      </div>
    );
  }

  const awaiting = order.status === 'PENDING_PAYMENT';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-maroon">
              {awaiting ? 'Payment processing' : 'Order confirmed'}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Reference <span className="font-mono text-xs">{order.reference}</span> · shipping to{' '}
              {order.destinationCountry}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {awaiting && (
          <div className="mt-4 flex items-start gap-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <div className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
            <div>
              <p className="font-medium">Waiting for payment confirmation</p>
              <p className="mt-1 leading-relaxed">
                Your payment was submitted. We confirm orders from Stripe&apos;s signed webhook, which
                usually arrives within seconds. This page updates on its own — no need to reload.
              </p>
            </div>
          </div>
        )}

        {order.status === 'PAID' && (
          <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
            Payment confirmed. Your workshop has been notified and will prepare the pieces for export.
          </p>
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-display text-lg text-maroon">Summary</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="text-stone-700">
                {item.title} <span className="text-stone-500">· {item.size} · ×{item.quantity}</span>
              </span>
              <span className="whitespace-nowrap text-stone-600">
                {formatMoney(Number(item.lineTotal), order.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-stone-200 pt-3 text-sm">
          <Row label="Subtotal" value={formatMoney(Number(order.totals.subtotal), order.currency)} />
          <Row label="Duties" value={formatMoney(Number(order.totals.duties), order.currency)} />
          <Row label="Tax" value={formatMoney(Number(order.totals.tax), order.currency)} />
          <Row label="Shipping" value={formatMoney(Number(order.totals.shipping), order.currency)} />
          <div className="flex justify-between pt-1 text-base font-semibold text-maroon">
            <dt>Total</dt>
            <dd>{formatMoney(Number(order.totals.total), order.currency)}</dd>
          </div>
        </dl>
      </div>

      {order.fittingSnapshot && (
        <div className="card p-6">
          <h2 className="font-display text-lg text-maroon">Measurements at purchase</h2>
          <p className="mt-1 text-xs text-stone-500">
            Frozen on {new Date(order.fittingSnapshot.capturedAt).toLocaleDateString()}. These are the
            measurements this order was sized against — later edits to your profile do not change them,
            which is what makes a return fair.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(order.fittingSnapshot.body)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-stone-100 py-1">
                  <dt className="text-stone-500">{labelFor(k)}</dt>
                  <dd className="text-stone-800">{typeof v === 'number' ? `${v} cm` : String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <Link href="/catalog" className="btn-primary inline-block">Continue shopping</Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-stone-700">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PENDING_PAYMENT'
      ? 'bg-amber-100 text-amber-800'
      : status === 'CANCELLED' || status === 'REFUNDED'
        ? 'bg-red-100 text-red-800'
        : 'bg-emerald-100 text-emerald-800';
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function labelFor(key: string): string {
  const map: Record<string, string> = {
    gender: 'Gender',
    heightCm: 'Height',
    weightKg: 'Weight',
    bustCm: 'Bust',
    chestCm: 'Chest',
    waistCm: 'Waist',
    hipCm: 'Hip',
  };
  return map[key] ?? key;
}
