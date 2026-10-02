'use client';

/**
 * Localised checkout pipeline.
 *
 * delivery -> payment -> review. The payment list is resolved from the
 * shopper's market, so a Korean customer sees KakaoPay and NaverPay first.
 *
 * This does NOT take a payment. The review step posts to /api/orders, creating
 * a PENDING_PAYMENT order for the webhook to complete once a real PSP exists
 * (Phase 2). Pretending to charge a card before the PSP is wired would be a
 * worse lie than an honest demo order.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { cartSubtotalUsd, useCartStore } from '@/store/cart-store';
import { MARKET_COUNTRIES, useMarketStore } from '@/store/market-store';
import { useMoney } from '@/components/shell/MoneyProvider';
import { calculateLandedCost } from '@/lib/duties';
import { paymentMethodsFor } from '@/lib/payments';
import { currencyForCountry, toMinorUnits, localeForCountry } from '@/lib/currency';
import { storeCheckoutToken } from '@/lib/stripe-client';
import { StripePaymentStep } from './StripePaymentStep';

type Step = 'delivery' | 'payment' | 'review' | 'pay';

const STEPS: Step[] = ['delivery', 'payment', 'review', 'pay'];

export function CheckoutView() {
  const lines = useCartStore((s) => s.lines);
  const clear = useCartStore((s) => s.clear);
  const setMarket = useMarketStore((s) => s.setMarket);
  const market = useMoney();
  const country = market.country;
  const { money, rate, currency } = market;

  const [step, setStep] = useState<Step>('delivery');
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', postcode: '' });
  const [method, setMethod] = useState('');
  const [placing, setPlacing] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the order exists and Stripe has a client secret for it.
  const [payment, setPayment] = useState<{ orderId: string; clientSecret: string } | null>(null);

  // One idempotency key per checkout ATTEMPT, stable across re-renders and
  // retries. A ref rather than state: regenerating it on every render would make
  // each click a new "attempt" and defeat the whole point.
  const checkoutKeyRef = useRef<string | null>(null);
  if (checkoutKeyRef.current === null) {
    const rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    checkoutKeyRef.current = `co_${rand}`;
  }
  const checkoutKey = checkoutKeyRef.current;

  const methods = useMemo(() => paymentMethodsFor(country), [country]);
  const subtotalUsd = useMemo(() => cartSubtotalUsd(lines), [lines]);
  const landed = useMemo(() => calculateLandedCost(subtotalUsd, country), [subtotalUsd, country]);

  const selected = methods.find((m) => m.provider === method) ?? methods[0];
  // DISPLAY ONLY. The amount actually charged is derived server-side from the
  // persisted Order.totalLocal in /api/checkout/create-intent — never from
  // anything computed here.
  //
  // The currency CODE decides the minor-unit exponent, not the payment method's
  // `zeroDecimal` flag: the flag is a property of the provider, but the minor
  // unit is a property of the money, and conflating them is how a JPY basket
  // ends up charged in cents.
  const minorUnits = toMinorUnits(landed.totalUsd * rate, currency);

  if (reference) {
    return (
      <div className="card mx-auto max-w-lg p-10 text-center">
        <p className="text-3xl">✓</p>
        <h1 className="mt-2 font-display text-2xl text-maroon">Order placed</h1>
        <p className="mt-1 text-sm text-stone-600">Reference {reference}</p>
        <p className="mt-3 text-xs leading-relaxed text-stone-500">
          In production this is where the payment provider takes the card. The order is now
          <span className="font-medium text-stone-700"> PENDING_PAYMENT</span> — once a webhook confirms payment,
          stock decrements and any supplier reorder is dispatched automatically.
        </p>
        <Link href="/catalog" className="btn-primary mt-6">
          Continue shopping
        </Link>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-12 text-center">
        <p className="font-display text-2xl text-maroon">Nothing to check out</p>
        <Link href="/catalog" className="btn-primary mt-6">
          Browse the collection
        </Link>
      </div>
    );
  }

  /**
   * Creates the order, then asks Stripe for a client secret.
   *
   * Deliberately two calls, not one. The order must exist and be linked to the
   * session BEFORE a payment intent is created, so that when the webhook fires
   * there is already an owned order to transition. Creating the intent first
   * leaves a window where a customer has paid and we have nothing to attach the
   * payment to.
   */
  async function placeOrder() {
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map((l) => ({ slug: l.slug, size: l.size, quantity: l.quantity, priceUsd: l.priceUsd })),
          destinationCountry: country,
          currency,
          fxRate: rate,
          paymentProvider: selected?.provider,
          amountMinor: minorUnits,
          email: form.email,
          shipping: form,
          // Stable per checkout attempt, so a double-click cannot create two
          // orders (and therefore two payment intents).
          idempotencyKey: checkoutKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not place the order');

      setReference(data.reference);

      // Held in sessionStorage for the confirmation screen. Never placed in a
      // URL — it is a bearer credential for this basket.
      if (data.checkoutToken) storeCheckoutToken(data.orderId, data.checkoutToken);

      const intentRes = await fetch('/api/checkout/create-intent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Sent as a header rather than in the body/query so it stays out of
          // logs and Referer headers.
          ...(data.checkoutToken ? { 'x-checkout-token': data.checkoutToken } : {}),
        },
        body: JSON.stringify({ orderId: data.orderId }),
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) {
        // The order exists and is payable; only the form failed to load. Say so
        // rather than implying the purchase failed — it may well be retried.
        throw new Error(
          intent.error
            ? `Order ${data.reference} was created, but the payment form could not load: ${intent.error}`
            : 'Order created, but the payment form could not load.',
        );
      }

      setPayment({ orderId: data.orderId, clientSecret: intent.clientSecret });
      setStep('pay');
      clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  const deliveryValid = !!(form.name && form.email && form.address && form.city && form.postcode);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="card p-6">
        <ol className="mb-6 flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                  step === s ? 'bg-maroon text-ivory' : 'bg-stone-200 text-stone-500'
                }`}
              >
                {i + 1}
              </span>
              <span className={step === s ? 'font-semibold text-maroon' : 'text-stone-500'}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-stone-300" />}
            </li>
          ))}
        </ol>

        {step === 'delivery' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 p-3">
              <div>
                <p className="text-xs font-medium text-stone-700">
                  Shipping to {MARKET_COUNTRIES.find((c) => c.code === country)?.name ?? 'your country'}
                </p>
                <p className="text-[11px] text-stone-500">Duties are calculated for this destination.</p>
              </div>
              <select
                value={country ?? ''}
                onChange={(e) => {
                  const code = e.target.value;
                  setMarket({ country: code, currency: currencyForCountry(code), locale: localeForCountry(code) });
                }}
                className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs"
              >
                <option value="">Select a country</option>
                {MARKET_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>

            <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} autoComplete="name" />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} autoComplete="email" />
            <Field label="Street address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} autoComplete="street-address" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} autoComplete="address-level2" />
              <Field label="Postcode" value={form.postcode} onChange={(v) => setForm({ ...form, postcode: v })} autoComplete="postal-code" />
            </div>

            <button type="button" disabled={!deliveryValid} onClick={() => setStep('payment')} className="btn-primary w-full">
              Continue to payment
            </button>
          </div>
        )}

        {step === 'payment' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              {MARKET_COUNTRIES.find((c) => c.code === country)?.name ?? 'Your country'} is served by these methods.
            </p>
            {methods.map((m) => {
              const active = (method || methods[0].provider) === m.provider;
              return (
                <label
                  key={m.provider}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                    active ? 'border-maroon bg-gold/5' : 'border-stone-200 hover:border-maroon/40'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="method"
                      value={m.provider}
                      checked={active}
                      onChange={() => setMethod(m.provider)}
                      className="accent-maroon"
                    />
                    <span className="text-sm text-stone-800">{m.label}</span>
                  </span>
                  {m.popular && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-maroon">Popular</span>}
                </label>
              );
            })}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setStep('delivery')} className="btn-ghost flex-1">Back</button>
              <button type="button" onClick={() => setStep('review')} className="btn-primary flex-1">Review order</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-stone-50 p-4 text-sm">
              <p className="text-stone-700"><strong>{form.name}</strong></p>
              <p className="text-stone-500">{form.address}</p>
              <p className="text-stone-500">{form.city} {form.postcode}</p>
              <p className="mt-1 text-stone-500">{form.email}</p>
              <p className="mt-2 border-t border-stone-200 pt-2 text-stone-600">
                Paying with <strong>{selected?.label}</strong>
              </p>
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('payment')} className="btn-ghost flex-1">Back</button>
              <button type="button" onClick={placeOrder} disabled={placing} className="btn-primary flex-1">
                {placing ? 'Placing…' : `Place order · ${money(landed.totalUsd)}`}
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-stone-400">
              The order is created and linked to your account before any payment is taken. If payment does not
              complete, the order stays PENDING_PAYMENT and nothing is charged.
            </p>
          </div>
        )}

        {step === 'pay' && payment && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Paying <strong className="text-stone-800">{money(landed.totalUsd)}</strong> for order{' '}
              <span className="font-mono text-xs">{reference}</span>.
            </p>
            <StripePaymentStep
              clientSecret={payment.clientSecret}
              orderId={payment.orderId}
              onComplete={() => setReference(reference)}
              onBack={() => setStep('review')}
            />
          </div>
        )}
      </div>

      <aside className="card h-fit p-5">
        <h2 className="font-display text-lg text-maroon">Summary</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {lines.map((l) => (
            <li key={`${l.slug}::${l.size}`} className="flex justify-between gap-2">
              <span className="text-stone-600">
                {l.title} <span className="text-stone-400">×{l.quantity} · {l.size}</span>
              </span>
              <span className="shrink-0">{money(l.priceUsd * l.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1.5 border-t border-stone-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-600">Duty</dt>
            <dd className={landed.dutyUsd > 0 ? '' : 'text-stone-400'}>{landed.dutyUsd > 0 ? money(landed.dutyUsd) : 'Waived'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Tax</dt>
            <dd className={landed.taxUsd > 0 ? '' : 'text-stone-400'}>{landed.taxUsd > 0 ? money(landed.taxUsd) : 'Waived'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Shipping</dt>
            <dd>{money(landed.shippingUsd)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="text-maroon">{money(landed.totalUsd)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-[10px] text-stone-400">
          Charged to the PSP as {minorUnits} minor units (
          {selected?.zeroDecimal ? 'zero-decimal' : 'two-decimal'} currency).
        </p>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="label-xs">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-maroon"
      />
    </label>
  );
}

