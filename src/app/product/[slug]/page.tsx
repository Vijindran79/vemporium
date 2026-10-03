import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CATALOG } from '@/lib/catalog';
import { AddToCartPanel, SeeOnAvatarButton, SizeMatchWidget } from '@/components/product/ProductPanels';
import { productJsonLd, breadcrumbJsonLd } from '@/lib/structured-data';
import { reviewsFor } from '@/lib/seed-reviews';
import { ReviewPanel } from '@/components/product/ReviewPanel';

export function generateStaticParams() {
  return CATALOG.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = CATALOG.find((p) => p.slug === slug);
  if (!item) return { title: 'Not found — Vemporium' };
  return {
    title: `${item.title} — Vemporium`,
    description: item.description,
    openGraph: { title: item.title, description: item.description },
  };
}

/**
 * Craft copy, keyed by the garment's primary fabric. This is the "why is this
 * worth the premium" content — for a global buyer, provenance is the product.
 */
const CRAFT_STORY: Record<string, { heading: string; body: string }> = {
  BANARASI_BROCATTE: {
    heading: 'Woven on a pit loom in Varanasi',
    body: 'Banarasi silk has been made on the ghats of Varanasi for over a thousand years. The kadhwa technique interlaces real zari — gold-wrapped thread — into a mulberry silk warp, often with a temple border worked on the pit loom itself. A single bridal saree can occupy three weavers for several weeks.',
  },
  CHANDERI: {
    heading: 'Gossamer-light, from Madhya Pradesh',
    body: 'Chanderi sits between silk and cotton: translucent enough to catch the light like silk, crisp enough to hold a pleat like cotton. It is woven on a pit loom in Chanderi, Madhya Pradesh, and traditionally used for summer court dress. The slubs visible in the fabric are a mark of the hand-spun yarn, not a flaw.',
  },
  GEORGETTE: {
    heading: 'Six metres of flare',
    body: 'A wedding lehenga is built in layers: a cotton or silk lining for structure, a georgette overlay for the drape, and hand-embroidered kantha borders worked separately and then attached. The flare is what makes it move — and it is why we size the waist to your avatar rather than to the label.',
  },
  COTTON: {
    heading: 'Lucknow chikankari, one stitch at a time',
    body: 'Chikankari is embroidery, not print. A single kurta can take a skilled karigah two to three weeks; the white thread is pulled from the reverse so the motif sits inside the fabric rather than on top. It was once court embroidery for the Nawabs of Lucknow, and it is still worked entirely by hand.',
  },
  RAW_SILK: {
    heading: 'Block printed in Bagru',
    body: 'Bagru, an hour outside Jaipur, is known for its mud-resist printing. Dyes are pressed into the cloth by hand through carved wooden blocks, then buried in natural mud to fix the colour — a process unchanged for centuries. Every print has a slight irregularity; a perfectly repeating pattern is a sign it was not hand done.',
  },
  SILK: {
    heading: 'Structured for the biggest day of the year',
    body: 'A wedding sherwani is cut like tailoring, not like a dress. The interlining, the stand collar and the weight of the brocade all have to hold a silhouette through a full day of movement. Ours is finished with a matching stole and made to be re-worn rather than discarded.',
  },
  CHIFFON: {
    heading: 'Rolled edges, not stitched',
    body: 'A chiffon dupatta of any quality is finished by rolling the edge between finger and thumb and setting it with heat, rather than hemming it. Machine-hemmed chiffon frays within a season; a hand-rolled edge survives decades. Ours is finished with hand-tied tassels.',
  },
};

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = CATALOG.find((p) => p.slug === slug);
  if (!item) notFound();

  const craft = CRAFT_STORY[item.fabric] ?? {
    heading: 'Made by a named workshop',
    body: 'Every piece on Vemporium is sourced from an identified workshop rather than a trading agent, so the maker and city travel with the garment.',
  };

  const drapeLabel = item.drapingType === 'WRAPPED' ? 'Wrapped' : item.drapingType === 'FLOWING' ? 'Flowing' : 'Structured';

  const productLd = productJsonLd(item, reviewsFor(item.slug));
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: item.categoryLabel + 's', path: '/catalog' },
    { name: item.title, path: '/product/' + item.slug },
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <nav className="mb-4 text-xs text-stone-500">
        <Link href="/" className="hover:text-maroon">Home</Link>
        <span className="mx-1.5">/</span>
        <Link href="/catalog" className="hover:text-maroon">{item.categoryLabel}s</Link>
        <span className="mx-1.5">/</span>
        <span className="text-stone-700">{item.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        {/* Media — the swatch stands in for photography until the CDN asset
            pipeline lands (Phase 2). */}
        <div>
          <div
            className="relative aspect-4/5 overflow-hidden rounded-2xl"
            style={{ backgroundColor: item.colourHex }}
            role="img"
            aria-label={`${item.title} in ${item.colourway}`}
          >
            {item.accentHex && <div className="absolute inset-x-0 bottom-0 h-8" style={{ backgroundColor: item.accentHex }} />}
            <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-maroon">{item.colourway}</span>
              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-stone-600">Woven in {item.originCity}</span>
            </div>
          </div>

          <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
            <span className="label-xs text-saffron">Fabric &amp; craft</span>
            <h2 className="mt-1 font-display text-xl text-maroon">{craft.heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{craft.body}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4 text-xs sm:grid-cols-4">
              {[
                ['Fabric', item.fabricLabel],
                ['Craft', item.workTypeLabel],
                ['Origin', item.originCity],
                ['Drape', drapeLabel],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-stone-400">{k}</dt>
                  <dd className="mt-0.5 font-medium text-stone-700">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* Buy column */}
        <div>
          <span className="label-xs">{item.categoryLabel}</span>
          <h1 className="mt-1 font-display text-3xl text-maroon">{item.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{item.description}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SeeOnAvatarButton item={item} />
            <span className="text-[11px] text-stone-400">See how it drapes on your own measurements</span>
          </div>

          <div className="mt-5">
            <SizeMatchWidget />
          </div>

          <div className="mt-5">
            <AddToCartPanel item={item} />
          </div>
        </div>
      </div>

      <div className="mt-12">
        <ReviewPanel reviews={reviewsFor(item.slug)} />
      </div>
    </main>
  );
}
