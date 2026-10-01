/**
 * Fit confidence scoring.
 *
 * The PDP promises a "Fits 96% in Size M" widget. A number that is not earned
 * is worse than no number — shoppers trust it, then return the item. So the
 * score here is deliberately conservative and transparent about what it
 * measures.
 *
 * What the score IS:
 *   How closely the shopper's body sits to a specific garment block, 0-100.
 *   A comfort/fit match, NOT a prediction of a return.
 *
 * What it is NOT:
 *   - Not a drape simulation result
 *   - Not a style judgement
 *   - Not a guarantee. Always keep the "size up" escape hatch visible.
 *
 * Below MINIMUM_CONFIDENCE we suppress the confident phrasing, because
 * over-confident bad advice is the failure mode that costs returns.
 */

import { isKid, isMens, type BodyParams, type SizeLabel } from './sizing';

export interface SizeFit {
  size: SizeLabel;
  /** 0-100. */
  score: number;
  /** Signed cm deltas, so the UI can say "2cm roomy at the waist". */
  deltas: { bust: number; waist: number; hip: number; height: number };
  ease: 'snug' | 'close' | 'true' | 'relaxed' | 'loose';
}

export interface FitReport {
  best: SizeFit;
  /** Every size scored, ordered best-first. */
  ranked: SizeFit[];
  recommended: SizeLabel;
  confident: boolean;
  notes: string[];
}

/** Ease bands, in cm of room between body and block. */
const EASE_BANDS: { max: number; ease: SizeFit['ease']; label: string }[] = [
  { max: -2, ease: 'snug', label: 'runs smaller than you — consider sizing up' },
  { max: 1.5, ease: 'close', label: 'fits close to the body' },
  { max: 4, ease: 'true', label: 'fits true to size' },
  { max: 8, ease: 'relaxed', label: 'relaxed through the body' },
  { max: Infinity, ease: 'loose', label: 'runs generous — consider sizing down' },
];

function easeFor(avgDelta: number): { ease: SizeFit['ease']; label: string } {
  return EASE_BANDS.find((b) => avgDelta <= b.max) ?? EASE_BANDS[EASE_BANDS.length - 1];
}

/**
 * Reference blocks, in cm of BODY girth (not garment girth). This mirrors the
 * ladder in sizing.ts; both are asserted consistent by the test suite.
 */
interface Block {
  label: SizeLabel;
  bust: number;
  waist: number;
  hip: number;
  chest: number;
  lo: number;
  hi: number;
}

const ADULT: Block[] = [
  { label: 'XS', bust: 80, waist: 60, hip: 86, chest: 84, lo: 150, hi: 168 },
  { label: 'S', bust: 84, waist: 64, hip: 90, chest: 89, lo: 150, hi: 172 },
  { label: 'M', bust: 89, waist: 69, hip: 96, chest: 94, lo: 152, hi: 176 },
  { label: 'L', bust: 95, waist: 75, hip: 103, chest: 101, lo: 154, hi: 180 },
  { label: 'XL', bust: 101, waist: 81, hip: 110, chest: 108, lo: 156, hi: 184 },
  { label: 'XXL', bust: 108, waist: 88, hip: 118, chest: 116, lo: 158, hi: 188 },
];

const KID: Block[] = [
  { label: 'XS', bust: 52, waist: 50, hip: 56, chest: 54, lo: 95, hi: 115 },
  { label: 'S', bust: 56, waist: 53, hip: 60, chest: 58, lo: 110, hi: 128 },
  { label: 'M', bust: 60, waist: 56, hip: 65, chest: 62, lo: 125, hi: 143 },
  { label: 'L', bust: 65, waist: 60, hip: 70, chest: 67, lo: 140, hi: 158 },
  { label: 'XL', bust: 70, waist: 64, hip: 76, chest: 72, lo: 155, hi: 172 },
  { label: 'XXL', bust: 76, waist: 69, hip: 82, chest: 78, lo: 168, hi: 185 },
];

/** Below this we stop making confident claims. */
export const MINIMUM_CONFIDENCE = 62;

function blocksFor(body: BodyParams): Block[] {
  return isKid(body.gender) ? KID : ADULT;
}

/** Relative deviation per garment, plus raw deltas for display. */
function scoreAgainst(body: BodyParams, block: Block): SizeFit {
  const mens = isMens(body.gender);
  const actualBust = mens ? body.chestCm ?? 96 : body.bustCm ?? 90;
  const targetBust = mens ? block.chest : block.bust;

  const deltas = {
    bust: actualBust - targetBust,
    waist: body.waistCm - block.waist,
    hip: body.hipCm - block.hip,
    // Height is a length concern, not a fit concern, so it barely moves the score.
    height: body.heightCm - (block.lo + block.hi) / 2,
  };

  // Weight each girth equally: a bad waist fit ruins a garment regardless of
  // how well the bust matches.
  const rel = [
    Math.abs(deltas.bust) / targetBust,
    Math.abs(deltas.waist) / block.waist,
    Math.abs(deltas.hip) / block.hip,
    // Height contributes a quarter as much, for hem length only.
    (Math.abs(deltas.height) / 100) * 0.25,
  ];
  const avgRel = rel.reduce((a, b) => a + b, 0) / rel.length;

  // 0% deviation -> 100, 25% deviation -> 0. The curve is deliberately steep:
  // a 12% girth error is a badly fitting garment and must not score ~85.
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - avgRel / 0.25))));

  const avgDelta = (deltas.bust + deltas.waist + deltas.hip) / 3;
  return { size: block.label, score, deltas, ease: easeFor(avgDelta).ease };
}

export function scoreFit(body: BodyParams): FitReport {
  const ranked = blocksFor(body)
    .map((b) => scoreAgainst(body, b))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const confident = best.score >= MINIMUM_CONFIDENCE;
  const notes: string[] = [];

  if (!confident) {
    notes.push('We could not find a confident match — a tailor can work from your exact measurements.');
  } else {
    const avg = (best.deltas.bust + best.deltas.waist + best.deltas.hip) / 3;
    notes.push(`Best match in ${best.size} — this block ${easeFor(avg).label}.`);
  }

  if (confident) {
    // A waist much roomier than the chest is the #1 alteration request, so
    // call it out specifically rather than burying it in an average.
    const { waist, bust } = best.deltas;
    if (waist - bust > 3) notes.push('Roomier at the waist than the chest — a tailor can take it in.');
    if (bust - waist > 4) notes.push('Snug across the chest with more room at the waist — consider the size up.');
  }

  // If the runner-up is within 3 points, the choice is genuinely a coin flip.
  // Saying so is more honest than a confident wrong answer.
  if (ranked[1] && best.score - ranked[1].score <= 3) {
    notes.push(`${ranked[1].size} scores almost identically (${ranked[1].score}%), so either is defensible.`);
  }

  return { best, ranked, recommended: best.size, confident, notes };
}

/** "96%" style label, or null when we are not confident enough to claim one. */
export function confidenceLabel(report: FitReport): string | null {
  return report.confident ? `${report.best.score}%` : null;
}
