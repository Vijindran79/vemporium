/**
 * Unit conversion.
 *
 * The PRD requires a metric/imperial toggle. Internally EVERYTHING is metric
 * (cm/kg) because the sizing engine, the drape maths and the database all
 * assume it. Conversion happens only at the display edge, so toggling units
 * can never silently corrupt an avatar.
 *
 * Rounding: body measurements are shown to 1 decimal in inches (a shopper
 * thinks "32.1 in", not "32 in"), and weight to whole pounds.
 */

export type UnitSystem = 'metric' | 'imperial';

export const CM_PER_INCH = 2.54;
export const KG_PER_LB = 0.45359237;

export function cmToIn(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inchToCm(inch: number): number {
  return inch * CM_PER_INCH;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Height in feet+inches, e.g. 170cm -> 5'7". */
export function toFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cmToIn(cm));
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

/** Formats a length for display in the given system. */
export function formatLength(cm: number, unit: UnitSystem): string {
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = toFeetInches(cm);
  return `${feet}′ ${inches}″`;
}

/** Formats a length for a slider readout, where precision beats prettiness. */
export function formatLengthPrecise(cm: number, unit: UnitSystem): string {
  if (unit === 'metric') return `${cm.toFixed(0)}`;
  return cmToIn(cm).toFixed(1);
}

export function formatWeight(kg: number, unit: UnitSystem): string {
  return unit === 'metric' ? `${kg.toFixed(1)} kg` : `${Math.round(kgToLb(kg))} lb`;
}

/** Slider step in the display unit, so imperial sliders do not jump in 2.54cm jumps. */
export function stepFor(unit: UnitSystem, maxCm: number): number {
  if (unit === 'metric') return maxCm > 150 ? 1 : 0.5;
  return maxCm > 150 ? 0.5 : 0.2;
}

export const UNIT_LABEL: Record<UnitSystem, string> = {
  metric: 'Metric (cm / kg)',
  imperial: 'Imperial (in / lb)',
};
