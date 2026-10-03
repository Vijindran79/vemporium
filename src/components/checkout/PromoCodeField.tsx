'use client';

/**
 * Promo code field for the checkout summary.
 *
 * Deliberately a DISPLAY-ONLY preview. Every number this component shows comes
 * from /api/promos/validate, which the shopper can forge; /api/orders
 * re-derives the discount from the stored promo on its own. This exists so that
 * "that code is not valid" is discovered while typing instead of at the payment
 * step, where it costs the sale.
 *
 * The parent re-sends the code with the order; if the server disagrees with
 * this panel, the server wins and the shopper is told at the review step.
 */

import { useState } from 'react';
import { useCartStore } from '@/store/cart-store';

export interface PromoPreview {
  code: string;
  discountUsd: number;
  freeShipping: boolean;
  totals: {
    goodsUsd: number;
    dutyUsd: number;
    taxUsd: number;
    shippingUsd: number;
    handlingUsd: number;
    totalUsd: number;
  };
}

interface Props {
  country: string | null;
  /** Called when a code is accepted, so checkout can include it in the order. */
  onApply: (preview: PromoPreview | null) => void;
  /** Passed through from the parent so the panel shows the discounted total. */
  applied: PromoPreview | null;
}

export function PromoCodeField({ country, onApply, applied }: Props) {
  const lines = useCartStore((s) => s.lines);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/promos/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: trimmed,
          destinationCountry: country,
          lines: lines.map((l) => ({ slug: l.slug, size: l.size, quantity: l.quantity })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not check that code');

      if (!data.ok) {
        setError(data.message ?? 'That code could not be applied.');
        onApply(null);
        return;
      }

      onApply({
        code: data.code,
        discountUsd: data.discountUsd,
        freeShipping: data.freeShipping,
        totals: data.totals,
      });
      // Normalise to the server's casing so the summary line shows exactly what
      // was evaluated, not what the shopper happened to type.
      setCode(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that code');
      onApply(null);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setCode('');
    setError(null);
    onApply(null);
  }

  if (applied) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-emerald-900">
              {applied.code} applied
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-800">
              {applied.freeShipping
                ? 'Free shipping applied'
                : 'Discount applied to your order'}
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            className="text-[11px] text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={apply} className="mt-4">
      <label htmlFor="promo" className="label-xs">
        Promo or voucher code
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="promo"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          placeholder="LAUNCH2026"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'promo-error' : undefined}
          className="min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-maroon"
        />
        <button type="submit" disabled={busy || !code.trim()} className="btn-ghost shrink-0 !px-4">
          {busy ? 'Checking…' : 'Apply'}
        </button>
      </div>

      {error && (
        <p id="promo-error" role="alert" className="mt-1.5 text-[11px] text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
