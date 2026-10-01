'use client';

/**
 * PDP client islands: size match widget, size picker, dynamic pricing and the
 * add-to-cart action.
 *
 * Kept client-side because they depend on the avatar store and the live market.
 * The page shell (craft story, media carousel) stays server-rendered.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAvatarStore } from '@/store/avatar-store';
import { useCartStore } from '@/store/cart-store';
import { useMarketStore } from '@/store/market-store';
import { useMoney } from '@/components/shell/MoneyProvider';
import { scoreFit } from '@/lib/fit';
import { SIZE_ORDER } from '@/lib/sizing';
import { bandForCountry, calculateLandedCost } from '@/lib/duties';
import { toGarmentSpec, type CatalogItem } from '@/lib/catalog';

/** "Fits 96% best in Size M" — with the per-size bars shown so the number is
 *  auditable rather than magic. */
export function SizeMatchWidget() {
  const body = useAvatarStore((s) => s.body);
  const report = useMemo(() => scoreFit(body), [body]);

  return (
    <div className="rounded-xl border border-gold/40 bg-gold/5 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-stone-800">Smart size match</h3>
        {report.confident ? (
          <span className="font-display text-2xl font-semibold text-maroon">{report.best.score}%</span>
        ) : (
          <span className="text-xs font-medium text-stone-500">No confident match</span>
        )}
      </div>

      {report.confident ? (
        <p className="mt-0.5 text-sm text-stone-700">
          Best in <strong className="text-maroon">{report.best.size}</strong> based on your avatar profile.
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-stone-600">
          We could not confidently match these measurements to a standard block.
        </p>
      )}

      <div className="mt-3 space-y-1">
        {report.ranked.map((r) => (
          <div key={r.size} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[11px] font-medium text-stone-500">{r.size}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
              <div
                className={`h-full rounded-full ${r.size === report.best.size ? 'bg-maroon' : 'bg-stone-300'}`}
                style={{ width: `${r.score}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] text-stone-400">{r.score}%</span>
          </div>
        ))}
      </div>

      {report.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {report.notes.map((n) => (
            <li key={n} className="text-[11px] leading-snug text-stone-600">
              • {n}
            </li>
          ))}
        </ul>
      )}

      <Link href="/fitting-room" className="mt-3 inline-block text-[11px] font-medium text-maroon underline-offset-2 hover:underline">
        Adjust my avatar →
      </Link>
    </div>
  );
}

export function AddToCartPanel({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const [size, setSize] = useState<string>('M');
  const [added, setAdded] = useState(false);
  const add = useCartStore((s) => s.add);
  const body = useAvatarStore((s) => s.body);
  const market = useMoney();
  const country = market.country;
  const { money } = market;

  const report = useMemo(() => scoreFit(body), [body]);
  const landed = useMemo(() => calculateLandedCost(item.priceUsd, country), [item.priceUsd, country]);
  const band = bandForCountry(country);

  function onAdd() {
    add(
      {
        slug: item.slug,
        title: item.title,
        size,
        priceUsd: item.priceUsd,
        colourHex: item.colourHex,
        accentHex: item.accentHex,
        categoryLabel: item.categoryLabel,
        fabricLabel: item.fabricLabel,
        originCity: item.originCity,
      },
      1,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="label-xs">Size</span>
          {report.confident && (
            <span className="text-[11px] text-stone-500">
              Recommended: <strong className="text-maroon">{report.recommended}</strong>
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SIZE_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              aria-pressed={size === s}
              className={`relative h-10 w-12 rounded-lg border text-sm font-medium transition-colors ${
                size === s ? 'border-maroon bg-maroon text-ivory' : 'border-stone-300 bg-white hover:border-maroon/40'
              }`}
            >
              {s}
              {report.recommended === s && (
                <span
                  className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${size === s ? 'bg-gold' : 'bg-saffron'}`}
                  title="Recommended for your avatar"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic pricing, duties included and shown before payment. */}
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-stone-700">Garment</span>
          <span className="text-lg font-semibold text-maroon">{money(item.priceUsd)}</span>
        </div>
        <dl className="mt-2 space-y-1 border-t border-stone-100 pt-2 text-xs">
          <div className="flex justify-between">
            <dt className="text-stone-500">Import duty{country ? ` (${country})` : ''}</dt>
            <dd className={landed.dutyUsd > 0 ? 'text-stone-700' : 'text-stone-400'}>
              {landed.dutyUsd > 0 ? money(landed.dutyUsd) : 'Waived'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Tax &amp; VAT</dt>
            <dd className={landed.taxUsd > 0 ? 'text-stone-700' : 'text-stone-400'}>
              {landed.taxUsd > 0 ? money(landed.taxUsd) : 'Waived'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Shipping</dt>
            <dd className="text-stone-700">{money(landed.shippingUsd)}</dd>
          </div>
          <div className="flex justify-between border-t border-stone-100 pt-1.5 text-sm font-medium">
            <dt>Estimated total</dt>
            <dd className="text-maroon">{money(landed.totalUsd)}</dd>
          </div>
        </dl>
        {landed.deMinimisApplied && (
          <p className="mt-2 text-[11px] text-emerald-700">
            ✓ Under the {money(band.deMinimisUsd)} de minimis threshold — no duty or import VAT.
          </p>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
          Final duties are confirmed by the carrier on delivery. Estimates are indicative.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button type="button" onClick={onAdd} className="btn-primary w-full">
          {added ? '✓ Added to cart' : 'Add to cart'}
        </button>
        <button type="button" onClick={() => router.push('/fitting-room')} className="btn-ghost w-full">
          See on my avatar
        </button>
      </div>
    </div>
  );
}

/** Loads this garment onto the avatar, then sends the shopper to the studio. */
export function SeeOnAvatarButton({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const wearGarment = useAvatarStore((s) => s.wearGarment);
  const setCompareGarment = useAvatarStore((s) => s.setCompareGarment);

  function onClick() {
    const spec = toGarmentSpec(item);
    wearGarment(spec);
    setCompareGarment(spec);
    router.push('/fitting-room');
  }

  return (
    <button type="button" onClick={onClick} className="btn-ghost">
      See on my avatar
    </button>
  );
}
