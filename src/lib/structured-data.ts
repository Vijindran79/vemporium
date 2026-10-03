/**
 * Schema.org JSON-LD builders.
 *
 * This is what makes a listing eligible for price, rating and availability
 * rich results in Google. Without it the store is text; with it the PDP can
 * render price and stars in the SERP, which is worth more than any on-page
 * tweak available to us.
 *
 * Two rules govern everything here:
 *
 *   1. STRUCTURED DATA MUST MATCH THE PAGE. If the JSON-LD claims 4.8 stars and
 *      the visible page says "No reviews yet", that is a manual-action risk, not
 *      a bug. Both numbers come from summarizeReviews() for exactly this reason.
 *   2. NO INVENTORY OR PRICING INVENTED HERE. Offers price and availability come
 *      from the same catalog row the page rendered from.
 */

import { summarizeReviews, type Review } from './reviews';
import type { CatalogItem } from './catalog';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vemporium.com';

export interface JsonLdOptions {
  /** Set when the shopper's detected market changes the displayed price. */
  priceLocal?: number;
  currency?: string;
}

export interface ProductJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Product';
  name: string;
  description: string;
  sku: string;
  category: string;
  material: string;
  /** Provenance is the product here, so it is first-class in the schema. */
  countryOfOrigin?: string;
  brand: { '@type': 'Brand'; name: string };
  offers: {
    '@type': 'Offer';
    price: string;
    priceCurrency: string;
    availability: string;
    url: string;
  };
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: string;
    reviewCount: number;
    bestRating: number;
    worstRating: number;
  };
  review?: Array<Record<string, unknown>>;
}

/**
 * Product + Offer + AggregateRating.
 *
 * `aggregateRating` is OMITTED entirely when there are no reviews. Emitting it
 * with a prior-derived number would be inventing a rating the store has never
 * received, which is the exact thing Google's review snippet policy forbids.
 */
export function productJsonLd(
  item: CatalogItem,
  reviews: Review[],
  options: JsonLdOptions = {},
): ProductJsonLd {
  const url = `${BASE_URL}/product/${item.slug}`;
  const currency = options.currency ?? 'USD';
  const price = options.priceLocal ?? item.priceUsd;
  const summary = summarizeReviews(reviews);

  const data: ProductJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.title,
    description: item.description,
    sku: item.slug,
    category: item.categoryLabel,
    material: item.fabricLabel,
    brand: { '@type': 'Brand', name: 'Vemporium' },
    offers: {
      '@type': 'Offer',
      // A string, and never rounded to 2dp here: Google rejects a price that
      // does not match the page, and float tails are the usual cause.
      price: price.toFixed(2),
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      url,
    },
  };

  // Every piece is woven in India. The CITY is already on the page as provenance
  // copy; the schema only needs the country.
  data.countryOfOrigin = 'IN';

  // Only when there is genuine evidence. Never emit a prior as a rating.
  if (summary.count > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: summary.average.toFixed(1),
      reviewCount: summary.count,
      bestRating: 5,
      worstRating: 1,
    };

    const published = reviews.filter((r) => r.published && r.body);
    if (published.length > 0) {
      data.review = published.slice(0, 5).map((r) => ({
        '@type': 'Review',
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
        author: { '@type': 'Person', name: 'Verified buyer' },
        reviewBody: r.body ?? '',
        datePublished: r.createdAt.toISOString().slice(0, 10),
      }));
    }
  }

  return data;
}

/** Organization + WebSite, for the homepage. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Vemporium',
    url: BASE_URL,
    description:
      'Indian ethnic wear sourced directly from named master weavers, with a 3D fitting room and local-currency pricing.',
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/**
 * BreadcrumbList. Shows the category trail in the SERP instead of a bare URL,
 * which lifts click-through and tells Google the catalog has real structure.
 */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${BASE_URL}${item.path}`,
    })),
  };
}
