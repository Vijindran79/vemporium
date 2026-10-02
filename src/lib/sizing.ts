/**
 * Avatar body model + size recommendation.
 *
 * The virtual fitting room needs a stable, well-tested mapping from a shopper's
 * body parameters to the size label a garment should be tried in. This is the
 * same "recommend my size" logic an offline store clerk would apply, made
 * deterministic so the 3D draper and the checkout agree.
 */

export type Gender = 'MALE' | 'FEMALE' | 'KID_BOY' | 'KID_GIRL';

export interface BodyParams {
  gender: Gender;
  heightCm: number;
  weightKg: number;
  /** Women + kids. */
  bustCm?: number;
  /** Men. */
  chestCm?: number;
  waistCm: number;
  hipCm: number;
}

export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type SizeLabel = (typeof SIZE_ORDER)[number] | 'Custom';

/** Reference garment blocks, in cm. Values are ease-inclusive chest/waist. */
interface Block {
  label: SizeLabel;
  /** girth (circumference) in cm the garment is cut to fit. */
  bust: number;
  waist: number;
  hip: number;
  chest: number;
  heightRange: [number, number];
  maxWeight: number;
}

const ADULT_BLOCKS: Block[] = [
  { label: 'XS', bust: 80, waist: 60, hip: 86,  chest: 84,  heightRange: [150, 168], maxWeight: 48 },
  { label: 'S',  bust: 84, waist: 64, hip: 90,  chest: 89,  heightRange: [150, 172], maxWeight: 55 },
  { label: 'M',  bust: 89, waist: 69, hip: 96,  chest: 94,  heightRange: [152, 176], maxWeight: 63 },
  { label: 'L',  bust: 95, waist: 75, hip: 103, chest: 101, heightRange: [154, 180], maxWeight: 73 },
  { label: 'XL', bust: 101, waist: 81, hip: 110, chest: 108, heightRange: [156, 184], maxWeight: 85 },
  { label: 'XXL',bust: 108, waist: 88, hip: 118, chest: 116, heightRange: [158, 188], maxWeight: 100 },
];

const KID_BLOCKS: Block[] = [
  { label: 'XS', bust: 52, waist: 50, hip: 56, chest: 54, heightRange: [95, 115],  maxWeight: 17 },
  { label: 'S',  bust: 56, waist: 53, hip: 60, chest: 58, heightRange: [110, 128], maxWeight: 22 },
  { label: 'M',  bust: 60, waist: 56, hip: 65, chest: 62, heightRange: [125, 143], maxWeight: 28 },
  { label: 'L',  bust: 65, waist: 60, hip: 70, chest: 67, heightRange: [140, 158], maxWeight: 35 },
  { label: 'XL', bust: 70, waist: 64, hip: 76, chest: 72, heightRange: [155, 172], maxWeight: 45 },
  { label: 'XXL',bust: 76, waist: 69, hip: 82, chest: 78, heightRange: [168, 185], maxWeight: 58 },
];

export function isKid(gender: Gender): boolean {
  return gender === 'KID_BOY' || gender === 'KID_GIRL';
}

/**
 * Physiological bounds, in cm/kg. Anything outside these is not a body, it is a
 * typo or a crafted request.
 */
export const BODY_LIMITS = {
  heightCm: [40, 230] as const,
  weightKg: [2, 250] as const,
  girthCm: [20, 200] as const,
};

function clampNum(v: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  // Math.min/max rather than an if-chain so NaN cannot slip through either.
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Range-checks and clamps untrusted measurements into BodyParams.
 *
 * `gender` is widened to string on purpose: this is fed straight off the wire,
 * so the signature must admit junk in order to reject it.
 *
 * Runs BEFORE anything is persisted, because these numbers drive a size
 * recommendation. A garbage waist of 999cm would not crash — it would silently
 * recommend XXL to someone, and that wrong size would ship.
 */
export function clampBodyParams(
  input: Omit<Partial<BodyParams>, 'gender'> & { gender?: string },
): BodyParams {
  const gender = (['MALE', 'FEMALE', 'KID_BOY', 'KID_GIRL'] as const).includes(input.gender as Gender)
    ? (input.gender as Gender)
    : 'FEMALE';

  const girth = BODY_LIMITS.girthCm;
  return {
    gender,
    heightCm: clampNum(input.heightCm, BODY_LIMITS.heightCm, 165),
    weightKg: clampNum(input.weightKg, BODY_LIMITS.weightKg, 60),
    bustCm: input.bustCm == null ? undefined : clampNum(input.bustCm, girth, 0),
    chestCm: input.chestCm == null ? undefined : clampNum(input.chestCm, girth, 0),
    waistCm: clampNum(input.waistCm, girth, 70),
    hipCm: clampNum(input.hipCm, girth, 95),
  };
}

export function isMens(gender: Gender): boolean {
  return gender === 'MALE' || gender === 'KID_BOY';
}

/**
 * Sensible starting values so the avatar is never rendered degenerate.
 *
 * Kids get CHILD measurements here, not adult ones scaled down. Getting this
 * wrong is subtle and costly: an adult waist on a 130cm child throws the size
 * engine into "Custom" for every child who opens the fitting room.
 */
export function defaultBody(gender: Gender): BodyParams {
  if (isKid(gender)) {
    // Mid-child-block reference (roughly a 9-year-old).
    return isMens(gender)
      ? { gender, heightCm: 134, weightKg: 28, waistCm: 57, hipCm: 67, chestCm: 64 }
      : { gender, heightCm: 134, weightKg: 28, waistCm: 57, hipCm: 67, bustCm: 62 };
  }
  if (isMens(gender)) {
    return { gender, heightCm: 170, weightKg: 65, waistCm: 71, hipCm: 98, chestCm: 96 };
  }
  return { gender, heightCm: 168, weightKg: 62, waistCm: 70, hipCm: 96, bustCm: 90 };
}


export interface SizeRecommendation {
  recommended: SizeLabel;
  /** Every label, ranked. Drives the "also consider" chips in the UI. */
  ranked: SizeLabel[];
  /** How far the body sits from the recommended block, in cm. */
  fitScore: number; // 0 = perfect, 1 = at the limit
  notes: string[];
}

function deviation(body: BodyParams, block: Block): number {
  const parts: number[] = [];
  const push = (actual: number | undefined, target: number) => {
    if (actual && actual > 0) parts.push(Math.abs(actual - target) / target);
  };
  push(isMens(body.gender) ? body.chestCm : body.bustCm, isMens(body.gender) ? block.chest : block.bust);
  push(body.waistCm, block.waist);
  push(body.hipCm, block.hip);
  // Height matters for garment length (kurti hem, lehenga flare), not fit.
  const [lo, hi] = block.heightRange;
  if (body.heightCm < lo) parts.push((lo - body.heightCm) / lo);
  if (body.heightCm > hi) parts.push((body.heightCm - hi) / hi);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

/** Maps avatar parameters to the garment size to try on / buy. */
export function recommendSize(body: BodyParams): SizeRecommendation {
  const blocks = isKid(body.gender) ? KID_BLOCKS : ADULT_BLOCKS;
  const notes: string[] = [];

  const scored = blocks
    .map((block) => ({ block, d: deviation(body, block) }))
    .sort((a, b) => a.d - b.d);

  const best = scored[0];
  const notesBody: string[] = [];

  // Anything beyond ~12% off the block is a real fit problem, so surface Custom.
  if (best.d > 0.12) {
    notesBody.push('Your measurements fall outside our standard blocks — we will tailor to your avatar parameters.');
    return { recommended: 'Custom', ranked: [ 'Custom', ...scored.map((s) => s.block.label) ], fitScore: best.d, notes: notesBody };
  }

  if (body.weightKg > best.block.maxWeight) {
    notesBody.push('Consider sizing up for comfort through the shoulders and arms.');
  }
  if (body.waistCm > best.block.waist * 1.08) {
    notesBody.push('Your waist runs high for this block — the belt and tie can be adjusted.');
  }
  if (body.heightCm < best.block.heightRange[0]) {
    notesBody.push('The hem will sit lower than the model photo — expect a longer fall.');
  }

  return {
    recommended: best.block.label,
    ranked: scored.map((s) => s.block.label),
    fitScore: best.d,
    notes: notesBody,
  };
}

/** BMI is useful to nudge the draper when weight and girth disagree. */
export function bmi(body: BodyParams): number {
  const m = body.heightCm / 100;
  return Math.round((body.weightKg / (m * m)) * 10) / 10;
}
