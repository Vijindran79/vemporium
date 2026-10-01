/**
 * Sample catalog.
 *
 * These mirror the Prisma Product rows so the fitting room is demonstrable
 * before Postgres is provisioned. Once seeded, swap the import in
 * /fitting-room for the DB query — the GarmentSpec shape is identical, which
 * is why draping never needs to know whether data came from a seed or a CMS.
 */

import type { DrapingType, GarmentSpec } from '@/store/avatar-store';

export interface CatalogItem extends GarmentSpec {
  slug: string;
  description: string;
  priceUsd: number;
  fabricLabel: string;
  workTypeLabel: string;
  originCity: string;
  categoryLabel: string;
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'p-banarasi-saree',
    slug: 'banarasi-silk-saree',
    title: 'Banarasi Silk Saree',
    description:
      'Handwoven in Varanasi from mulberry silk with real zari brocade. Traditional kadhwa weave with a temple border.',
    priceUsd: 189,
    category: 'SAREE',
    categoryLabel: 'Saree',
    drapingType: 'WRAPPED',
    colourHex: '#7B1E3A',
    accentHex: '#C9A227',
    flare: 0.28,
    lengthCm: 112,
    fabric: 'BANARASI_BROCATTE',
    fabricLabel: 'Banarasi brocade',
    workTypeLabel: 'Zari',
    originCity: 'Varanasi',
  },
  {
    id: 'p-chanderi-saree',
    slug: 'chanderi-saree',
    title: 'Chanderi Silk Saree',
    description:
      'Featherweight Chanderi from Madhya Pradesh, sheer enough to read as gold in sunlight. Contrasting cotton-silk border.',
    priceUsd: 124,
    category: 'SAREE',
    categoryLabel: 'Saree',
    drapingType: 'WRAPPED',
    colourHex: '#C9A227',
    accentHex: '#7B1E3A',
    flare: 0.22,
    lengthCm: 108,
    fabric: 'CHANDERI',
    fabricLabel: 'Chanderi silk-cotton',
    workTypeLabel: 'Plain',
    originCity: 'Chanderi',
  },
  {
    id: 'p-lehenga',
    slug: 'flared-lehenga',
    title: 'Flared Lehenga Set',
    description: 'Six-metre flare with a hand-embroidered kantha border, a structured blouse and a net dupatta.',
    priceUsd: 265,
    category: 'LEHENGA',
    categoryLabel: 'Lehenga',
    drapingType: 'FLOWING',
    colourHex: '#B03A6A',
    accentHex: '#F1D06B',
    flare: 0.62,
    lengthCm: 104,
    fabric: 'GEORGETTE',
    fabricLabel: 'Georgette',
    workTypeLabel: 'Embroidery',
    originCity: 'Jaipur',
  },
  {
    id: 'p-kurta',
    slug: 'chikankari-kurta',
    title: 'Chikankari Cotton Kurta',
    description: 'Hand-embroidered Lucknow chikankari on breathable cotton, with a mandarin collar and side slits.',
    priceUsd: 68,
    category: 'KURTA',
    categoryLabel: 'Kurta',
    drapingType: 'RIGID',
    colourHex: '#EDE3D2',
    accentHex: '#8A7A5C',
    flare: 0.1,
    lengthCm: 76,
    fabric: 'COTTON',
    fabricLabel: 'Pure cotton',
    workTypeLabel: 'Chikankari',
    originCity: 'Lucknow',
  },
  {
    id: 'p-kurti',
    slug: 'silk-kurti',
    title: 'Raw Silk Kurti',
    description: 'Featherweight raw silk kurti, hand block printed in Bagru. Works with jeans or a lehenga.',
    priceUsd: 52,
    category: 'KURTI',
    categoryLabel: 'Kurti',
    drapingType: 'RIGID',
    colourHex: '#4A6B8A',
    accentHex: '#E8D9B0',
    flare: 0.14,
    lengthCm: 68,
    fabric: 'RAW_SILK',
    fabricLabel: 'Raw silk',
    workTypeLabel: 'Block print',
    originCity: 'Bagru',
  },
  {
    id: 'p-sherwani',
    slug: 'sherwani',
    title: 'Zari Sherwani',
    description: 'Structured brocade sherwani with a matching stole — made for weddings, built to be re-worn.',
    priceUsd: 320,
    category: 'SHERWANI',
    categoryLabel: 'Sherwani',
    drapingType: 'RIGID',
    colourHex: '#2E1A3B',
    accentHex: '#C9A227',
    flare: 0.08,
    lengthCm: 102,
    fabric: 'SILK',
    fabricLabel: 'Silk brocade',
    workTypeLabel: 'Zari',
    originCity: 'Lucknow',
  },
  {
    id: 'p-dupatta',
    slug: 'chiffon-dupatta',
    title: 'Chiffon Dupatta',
    description: 'Hand-rolled edge chiffon dupatta with a tassel finish, in jewel tones.',
    priceUsd: 38,
    category: 'DUPATTA',
    categoryLabel: 'Dupatta',
    drapingType: 'WRAPPED',
    colourHex: '#1F6F6B',
    accentHex: '#E8D9B0',
    flare: 0.34,
    lengthCm: 96,
    fabric: 'CHIFFON',
    fabricLabel: 'Chiffon',
    workTypeLabel: 'Plain',
    originCity: 'Surat',
  },
];

export const CATEGORIES = ['Saree', 'Lehenga', 'Kurta', 'Kurti', 'Sherwani', 'Dupatta'] as const;
export type CategoryFilter = (typeof CATEGORIES)[number] | 'All';

export function filterCatalog(category: CategoryFilter): CatalogItem[] {
  if (category === 'All') return CATALOG;
  return CATALOG.filter((c) => c.categoryLabel === category);
}

/** Strips the extra catalog fields, leaving the shape the draper needs. */
export function toGarmentSpec(item: CatalogItem): GarmentSpec {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    drapingType: item.drapingType as DrapingType,
    colourHex: item.colourHex,
    flare: item.flare,
    lengthCm: item.lengthCm,
    accentHex: item.accentHex,
    fabric: item.fabric,
  };
}
