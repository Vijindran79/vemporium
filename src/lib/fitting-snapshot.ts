/**
 * Immutable fitting snapshot.
 *
 * WHY THIS IS A SEPARATE TABLE COLUMN AND NOT A FOREIGN KEY
 * ---------------------------------------------------------
 * `OrderItem.variantLabel` records which size was bought. It does NOT record
 * what body that size was chosen for. A shopper who updates their measurements
 * next month would otherwise make a return three months from now impossible to
 * judge — we would compare the garment against their NEW body and conclude the
 * fit was fine, or worse, blame the shopper for a fault that belongs to us.
 *
 * So the order freezes the body as it stood at the moment of purchase.
 *
 * DATA MINIMISATION
 * -----------------
 * Measurements only. No skin tone, no hairstyle, no weight-derived inferences.
 * Those do not affect fit, and this column outlives the account it came from
 * (see eraseScrubbableData), so every field written here is data we keep
 * permanently. The narrower this is, the better.
 *
 * Deliberately NOT stored: the avatar id. A pointer would let this snapshot be
 * silently refreshed from a changed profile, which is the exact bug this exists
 * to prevent.
 */

import type { BodyParams } from './sizing';

export interface FittingItemSnapshot {
  slug: string;
  title: string;
  size: string;
  quantity: number;
}

export interface FittingSnapshot {
  /** ISO timestamp of capture, for provenance in a dispute. */
  capturedAt: string;
  body: {
    gender: BodyParams['gender'];
    heightCm: number;
    weightKg: number;
    bustCm: number | null;
    chestCm: number | null;
    waistCm: number;
    hipCm: number;
  };
  items: FittingItemSnapshot[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Builds the snapshot. Pure, so the shape of a permanent record is pinned by
 * tests rather than reviewed by eye.
 */
export function buildFittingSnapshot(
  body: BodyParams,
  items: FittingItemSnapshot[],
  now: Date = new Date(),
): FittingSnapshot {
  return {
    capturedAt: now.toISOString(),
    body: {
      gender: body.gender,
      heightCm: round1(body.heightCm),
      weightKg: round1(body.weightKg),
      // Normalised to number|null so the JSON shape never changes. A field that
      // is sometimes a number and sometimes undefined is a schema you cannot
      // query three years from now.
      bustCm: body.bustCm == null ? null : round1(body.bustCm),
      chestCm: body.chestCm == null ? null : round1(body.chestCm),
      waistCm: round1(body.waistCm),
      hipCm: round1(body.hipCm),
    },
    items: items.map((i) => ({
      slug: i.slug,
      title: i.title,
      size: i.size,
      quantity: i.quantity,
    })),
  };
}

/** Type guard for a value read back from the JSON column. */
export function isFittingSnapshot(v: unknown): v is FittingSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<FittingSnapshot>;
  return typeof s.capturedAt === 'string' && !!s.body && typeof s.body.waistCm === 'number';
}

