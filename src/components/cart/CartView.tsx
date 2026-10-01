'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { cartSubtotalUsd, useCartStore } from '@/store/cart-store';
import { useMarketStore } from '@/store/market-store';
import { useMoney } from '@/components/shell/MoneyProvider';
import { calculateLandedCost } from '@/lib/duties';
import { paymentMethodsFor } from '@/lib/payments';

export function CartView() {
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const currency = useMarketStore((s) => s.currency);
  const market = useMoney();
  const country = market.country;
  const { money, rate } = market;

  const subtotalUsd = useMemo(() => cartSubtotalUsd(lines), [lines]);
  const landed = useMemo(() => calculateLandedCost(subtotalUsd, country), [subtotalUsd, country]);
  const methods = useMemo(() => paymentMethodsFor(country), [country]);

  if (lines.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-12 text-center">
        <p className="font-display text-2xl text-maroon">Your cart is empty</p>
        <p className="mt-2 text-sm text-stone-500">
          Build an avatar and try a few pieces on — it is the fastest way to know what will fit.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/fitting-room" className="btn-primary">Open the fitting room</Link>
          <Link href="/catalog" className="btn-ghost">Browse the collection</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={`${line.slug}::${line.size}`} className="card flex gap-4 p-3">
            <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg" style={{ backgroundColor: line.colourHex }} aria-hidden="true">
              {line.accentHex && <div className="absolute inset-x-0 bottom-0 h-2" style={{ backgroundColor: line.accentHex }} />}
            </div>

            <div className="flex flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/product/${line.slug}`} className="text-sm font-medium text-stone-800 hover:text-maroon">
                    {line.title}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-stone-500">
                    Size {line.size} · {line.fabricLabel} · {line.originCity}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(line.slug, line.size)}
                  className="text-[11px] text-stone-400 underline-offset-2 hover:text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>

              <div className="mt-auto flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <QtyButton onClick={() => setQuantity(line.slug, line.size, line.quantity - 1)} aria-label="Decrease quantity">−</QtyButton>
                  <span className="w-7 text-center text-sm">{line.quantity}</span>
                  <QtyButton onClick={() => setQuantity(line.slug, line.size, line.quantity + 1)} aria-label="Increase quantity">+</QtyButton>
                </div>
                <span className="text-sm font-semibold text-maroon">{money(line.priceUsd * line.quantity)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Itemised summary with the FX rate shown explicitly, as the spec asks. */}
      <aside className="card h-fit p-5">
        <h2 className="font-display text-lg text-maroon">Order summary</h2>

        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-600">Subtotal</dt>
            <dd className="font-medium">{money(subtotalUsd)}</dd>
          </div>
          <div className="flex justify-between text-[11px] text-stone-400">
            <dt>Base price</dt>
            <dd>
              ${subtotalUsd.toFixed(2)} USD @ {rate.toFixed(4)} {currency}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Import duty</dt>
            <dd className={landed.dutyUsd > 0 ? '' : 'text-stone-400'}>
              {landed.dutyUsd > 0 ? money(landed.dutyUsd) : 'Waived'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Tax &amp; VAT</dt>
            <dd className={landed.taxUsd > 0 ? '' : 'text-stone-400'}>
              {landed.taxUsd > 0 ? money(landed.taxUsd) : 'Waived'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-600">Shipping{country ? ` to ${country}` : ''}</dt>
            <dd>{money(landed.shippingUsd)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="text-maroon">{money(landed.totalUsd)}</dd>
          </div>
        </dl>

        {landed.deMinimisApplied && (
          <p className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
            Under the de minimis threshold — no duty or import VAT charged.
          </p>
        )}

        <Link href="/checkout" className="btn-primary mt-4 w-full">
          Continue to checkout
        </Link>

        <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
          Available payment methods: {methods.map((m) => m.label).join(', ')}.
        </p>
      </aside>
    </div>
  );
}

function QtyButton({ onClick, children, ...rest }: { onClick: () => void; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 w-7 rounded-md border border-stone-300 bg-white text-sm leading-none hover:border-maroon/40"
      {...rest}
    >
      {children}
    </button>
  );
}
