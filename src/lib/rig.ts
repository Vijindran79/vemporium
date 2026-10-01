/**
 * Parametric rig scaling.
 *
 * Lives in `lib` rather than inside the React component on purpose: this is the
 * maths that decides whether a shopper's body looks like their body, and it has
 * to be unit-testable without a WebGL context or a JSX runtime. The component
 * imports it; the test suite imports it too.
 *
 * WHY NOT JUST SCALE THE MESH
 * ---------------------------
 * Uniformly scaling a human mesh is wrong. `scale={[waistScale, 1, hipScale]}`
 * on the root stretches the head, neck and arms along with the torso, and
 * produces a barrel-shaped body for anyone whose bust and hip differ.
 * Anthropometry is regional — a 5cm height change moves the hip far more than
 * the waist — so a parametric rig scales BONES, each normalised against the
 * rig's own rest measurements.
 *
 * Artist contract (see docs/GLB-PIPELINE.md):
 *   Bone names are matched case-insensitively, in this priority order:
 *     hips       -> hip girth          spine     -> waist depth
 *     chest      -> bust/chest girth   shoulder  -> shoulder width
 *     upperArmL/R-> limb girth          thighL/R  -> limb girth
 *   Absent bones are skipped, so a partial rig still works.
 */

import type { BodyParams } from './sizing';

/** Rest measurements the rig is authored against, in cm. */
export const RIG_REST = {
  heightCm: 170,
  /**
   * ONE rest girth for both bust and chest.
   *
   * A rig is a single mesh with a single rest pose, so it cannot have two
   * different rest girths. An earlier version used chestCm: 96 for menswear
   * and bustCm: 90 for womenswear against the same rig, which quietly made a
   * 110cm chest and a 110cm bust scale differently.
   */
  girthCm: 90,
  waistCm: 70,
  hipCm: 95,
} as const;

export type BoneRole = 'hips' | 'spine' | 'chest' | 'shoulder' | 'arm' | 'thigh';
export type BoneScale = [number, number, number];

/** Bone name -> role. Order matters: the first match wins. */
export const BONE_ROLE_PATTERNS: [RegExp, BoneRole][] = [
  [/(hips|pelvis)/i, 'hips'],
  [/(spine|waist)/i, 'spine'],
  [/(chest|torso|bust)/i, 'chest'],
  [/(shoulder|clavicle)/i, 'shoulder'],
  [/(upperarm|arm)/i, 'arm'],
  [/(thigh|leg|upleg)/i, 'thigh'],
];

/** Resolves a bone name to its role, or null if the rig has no such bone. */
export function roleForBone(name: string): BoneRole | null {
  return BONE_ROLE_PATTERNS.find(([re]) => re.test(name))?.[1] ?? null;
}

function isMensLike(body: BodyParams): boolean {
  return body.gender === 'MALE' || body.gender === 'KID_BOY';
}

/**
 * Per-bone scale factors, normalised against the rig's rest measurements.
 *
 * Multipliers around 1.0 rather than absolute sizes, so a rig authored at any
 * rest pose still lands correctly. A body matching RIG_REST exactly produces
 * 1.0 on every axis.
 */
/**
 * Normalised girth ratio.
 *
 * Both bust and chest are expressed against the SAME rest reference, so a
 * 110cm chest and a 110cm bust scale identically. Using each measurement's own
 * rest value (chest 96 vs bust 90) would make menswear and womenswear drift
 * apart — a subtle inconsistency that only ever shows up on one of them.
 */
function girthRatio(body: BodyParams): number {
  const actual = isMensLike(body) ? body.chestCm ?? RIG_REST.girthCm : body.bustCm ?? RIG_REST.girthCm;
  return actual / RIG_REST.girthCm || 1;
}

export function computeBoneScales(body: BodyParams): Record<BoneRole, BoneScale> {
  // `|| 1` guards a missing measurement: a zero would collapse the rig flat.
  const hip = body.hipCm / RIG_REST.hipCm || 1;
  const waist = body.waistCm / RIG_REST.waistCm || 1;
  const girth = girthRatio(body);
  const height = body.heightCm / RIG_REST.heightCm || 1;

  // A torso is a tapered volume: depth (Z) tracks girth more than width (X),
  // because a real ribcage deepens as it widens. Scaling both equally is what
  // makes procedural avatars look like balloons.
  const girthX = 1 + (girth - 1) * 0.75;
  const girthZ = 1 + (girth - 1) * 1.0;

  // Every term below is written as "1 + (ratio - 1) * k" so a body matching the
  // rest pose returns exactly 1.0 on EVERY axis. A bare constant multiplier
  // (e.g. `* 0.95`) silently deforms the rest pose instead of scaling it,
  // which is how shoulders ended up permanently shrugged.
  const shoulderX = 1 + (girth - 1) * 0.75;
  const shoulderZ = 1 + (girth - 1) * 0.4;

  return {
    hips: [1 + (hip - 1) * 0.7, height, 1 + (hip - 1) * 0.9],
    spine: [1 + (waist - 1) * 0.6, 1, 1 + (waist - 1) * 0.8],
    chest: [girthX, 1, girthZ],
    shoulder: [shoulderX, 1, shoulderZ],
    arm: [1 + (girth - 1) * 0.45, height, 1 + (girth - 1) * 0.45],
    thigh: [1 + (hip - 1) * 0.4, height, 1 + (hip - 1) * 0.4],
  };
}
