import type { MetadataRoute } from 'next';
import { CATALOG } from '@/lib/catalog';

/**
 * XML sitemap.
 *
 * Without this the catalog is only discoverable by crawling from the homepage,
 * which no search engine will do for a store with a few hundred products. Every
 * PDP is a landing page waiting for a shopper who has never heard of us.
 *
 * Prices carry `lastModified` because a garment that changed price or was
 * delisted should be re-crawled, while a static editorial page need not be.
 */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://vemporium.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: `${BASE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/catalog`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/fitting-room`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },

    ...CATALOG.map((product) => ({
      url: `${BASE_URL}/product/${product.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
