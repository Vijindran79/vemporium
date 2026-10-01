/**
 * Landing page (server component).
 *
 * Prices are resolved on the server from the visitor's detected market, so the
 * first paint already shows the correct local currency — no client-side flash
 * of the wrong symbol, which is the difference between feeling global and
 * feeling broken.
 */

import Link from 'next/link';
import { CatalogGrid } from '@/components/catalog/CatalogGrid';
import { CATALOG, CATEGORIES } from '@/lib/catalog';
import { resolveGeo } from '@/lib/geo';
import { getRate, convert, formatMoney } from '@/lib/fx';
import { calculateLandedCost } from '@/lib/duties';
import { paymentMethodsFor } from '@/lib/payments';
import { CURRENCIES } from '@/lib/currency';
import { COUNTRY_NAMES } from '@/lib/markets';

export const dynamic = 'force-dynamic';

/** Category navigation split by audience, per the spec. */
const AUDIENCE: { label: string; detail: string }[] = [
  { label: 'Women', detail: 'Sarees, lehengas, kurtis' },
  { label: 'Men', detail: 'Sherwanis, kurtas' },
  { label: 'Boys', detail: 'Kurta sets' },
  { label: 'Girls', detail: 'Kurtis, lehengas' },
];

const CRAFT_TAGS = ['Zari', 'Chanderi', 'Chikankari', 'Block print', 'Kantha', 'Banarasi'];

export default async function HomePage() {
  const geo = await resolveGeo();
  const rate = await getRate(geo.currency);
  const meta = CURRENCIES[geo.currency];
  const methods = paymentMethodsFor(geo.country);

  const featured = CATALOG.slice(0, 4);
  const fromPriceUsd = Math.min(...featured.map((p) => p.priceUsd));
  const fromPrice = convert(fromPriceUsd, rate, geo.currency);

  // Worst-case landed cost across the rail, so the "from" claim is honest.
  const sampleLanded = calculateLandedCost(fromPriceUsd, geo.country);

  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:pt-20">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <div>
            <p className="label-xs text-saffron">
              {geo.country
                ? `Shipping to ${COUNTRY_NAMES[geo.country] ?? geo.country}`
                : 'Shipping worldwide · set your country at checkout'}
            </p>
            <h1 className="mt-3 font-display text-4xl leading-[1.1] text-maroon sm:text-5xl">
              Indian ethnic wear, <br />
              fitted to <em className="text-saffron">you</em>.
            </h1>
            <p className="mt-4 max-w-prose text-stone-600">
              Kurtas, Sarees, Lehengas and Sherwanis from master weavers across India. Build a 3D avatar with your
              own measurements, see how each garment actually falls on you, and pay in your local currency — with
              duties shown before you check out.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/fitting-room" className="btn-primary">
                Open the fitting room
              </Link>
              <a href="#collection" className="btn-ghost">
                Browse the collection
              </a>
            </div>

            <p className="mt-4 text-sm text-stone-500">
              Garments from{' '}
              <span className="font-semibold text-maroon">{formatMoney(fromPrice, geo.currency, meta.locale)}</span>
              {sampleLanded.dutyUsd > 0 && (
                <> · plus {formatMoney(convert(sampleLanded.dutyUsd + sampleLanded.taxUsd, rate, geo.currency), geo.currency)} duties to {geo.country}</>
              )}
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-stone-200">
              {[
                { k: '3D fitting room', v: 'Your measurements, real drape' },
                { k: 'Local currency', v: `Prices in ${geo.currency}` },
                { k: 'Duties upfront', v: 'Landed cost before you pay' },
                { k: 'Direct from India', v: 'No middleman markup' },
              ].map((f) => (
                <div key={f.k} className="bg-white p-4">
                  <p className="text-sm font-semibold text-maroon">{f.k}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{f.v}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-stone-200 bg-ivory p-4">
              <p className="label-xs">Pay your way</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {methods.slice(0, 5).map((m) => (
                  <span key={m.provider} className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-600">
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Category navigation — audience, then garment type, then craft. */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="font-display text-2xl text-maroon">Shop by</h2>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AUDIENCE.map((a) => (
            <Link key={a.label} href="/catalog" className="card p-4 transition-colors hover:border-maroon/40 hover:bg-gold/5">
              <p className="font-display text-lg text-maroon">{a.label}</p>
              <p className="mt-0.5 text-[11px] text-stone-500">{a.detail}</p>
            </Link>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <Link
              key={c}
              href="/catalog"
              className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition-colors hover:border-maroon/40 hover:text-maroon"
            >
              {c}s
            </Link>
          ))}
        </div>

        <p className="label-xs mt-5">Or by craft</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CRAFT_TAGS.map((t) => (
            <Link
              key={t}
              href="/catalog"
              className="rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-600 transition-colors hover:bg-maroon hover:text-ivory"
            >
              {t}
            </Link>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section id="collection" className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-2xl text-maroon">Featured pieces</h2>
            <p className="mt-1 text-sm text-stone-600">Each one drapes differently on your avatar — try them on.</p>
          </div>
          <Link href="/catalog" className="text-sm text-maroon underline-offset-4 hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-5">
          <CatalogGrid items={featured} />
        </div>
      </section>
    </main>
  );
}
