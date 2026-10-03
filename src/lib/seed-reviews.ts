/**
 * Seed reviews.
 *
 * Stands in for the Review table until the catalog moves from the bundled
 * sample to Postgres, exactly as catalog.ts does for products. The shape is the
 * one lib/reviews.ts consumes, so switching to a DB query is an import swap and
 * not a rewrite of the PDP.
 *
 * These are clearly fictional buyer accounts. They exist so the review UI, the
 * Bayesian average and the JSON-LD can be exercised end to end; swap this module
 * for a Prisma query before accepting real orders.
 */

import type { Review } from './reviews';
import type { CatalogItem } from './catalog';

const day = 86_400_000;
const EPOCH = new Date('2026-10-10T00:00:00Z').getTime();

const review = (
  slug: string,
  n: number,
  rating: Review['rating'],
  body: string,
  fit: Review['fitFeedback'],
  size: string,
  photos: number,
): Review => ({
  id: `${slug}-seed-${n}`,
  rating,
  title: body.split('.')[0]?.slice(0, 60) ?? null,
  body,
  photoCount: photos,
  purchasedSize: size,
  fitFeedback: fit,
  createdAt: new Date(EPOCH - n * 9 * day),
  published: true,
});

const SEED: Record<string, Review[]> = {
  'banarasi-silk-saree': [
    review('banarasi-silk-saree', 1, 5, 'The zari is real gold-wrapped thread, not plastic film. It caught the light all evening. Heavier than I expected in the best way.', 'TRUE_TO_SIZE', 'M', 3),
    review('banarasi-silk-saree', 2, 5, 'Woven in Varanasi as described and the temple border is hand-finished. Wore it to a wedding and got asked about it constantly.', 'TRUE_TO_SIZE', 'M', 2),
    review('banarasi-silk-saree', 3, 4, 'Beautiful work. The blouse piece is unstitched, so plan for that, but the saree itself is flawless.', 'LENGTH_LONG', 'L', 1),
    review('banarasi-silk-saree', 4, 5, 'The drape simulation matched what arrived almost exactly, which I did not expect. No surprises at all.', 'TRUE_TO_SIZE', 'S', 2),
  ],
  'chanderi-saree': [
    review('chanderi-saree', 1, 5, 'Sheer enough to read as gold in sunlight, exactly as the listing said. Cool enough for a summer afternoon.', 'TRUE_TO_SIZE', 'M', 1),
    review('chanderi-saree', 2, 4, 'Gorgeous fabric. The drape is soft rather than structured, so it suits a loose drape better than a formal one.', 'TRUE_TO_SIZE', 'M', 1),
    review('chanderi-saree', 3, 5, 'The slubs are real and not a flaw, as described. Third one I have bought from this workshop.', 'TRUE_TO_SIZE', 'L', 0),
  ],
  'lucknow-chikankari-kurta': [
    review('lucknow-chikankari-kurta', 1, 5, 'Two and a half weeks of hand work is visible in every motif. Wore it through a whole wedding day comfortably.', 'TRUE_TO_SIZE', 'M', 2),
    review('lucknow-chikankari-kurta', 2, 3, 'Lovely chikankari but it runs narrow at the chest. I am usually an M and needed to size up.', 'TOO_SMALL', 'M', 1),
    review('lucknow-chikankari-kurta', 3, 5, 'The white thread sits inside the fabric rather than on top. You can tell it is hand work the moment you touch it.', 'TRUE_TO_SIZE', 'L', 3),
    review('lucknow-chikankari-kurta', 4, 4, 'Soft cotton and breathes well. Slightly shorter in the body than I expected, would have liked 3cm more.', 'LENGTH_SHORT', 'M', 0),
  ],
};

/**
 * Reviews for a product. Unknown slugs return an empty list rather than
 * undefined, so the PDP never has to branch.
 */
export function reviewsFor(slug: string): Review[] {
  return SEED[slug] ?? [];
}

/** How many products carry seeded reviews, for the catalog star badges. */
export function reviewCountsBySlug(items: CatalogItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const list = SEED[item.slug];
    if (list && list.length > 0) counts[item.slug] = list.length;
  }
  return counts;
}
