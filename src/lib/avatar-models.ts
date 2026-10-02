/**
 * Bundled avatar bases + hair pieces.
 *
 * Bodies are Quaternius "Casual" models (CC0, public domain) with the child
 * base derived from the female one (see scripts/derive-child.mjs). Hair is
 * generated in-house (see scripts/generate-hair.mjs), so it is ours outright.
 * Full provenance: docs/GLB-PIPELINE.md.
 *
 * The numbers below are measurements of the bind pose in each file's own
 * model space (metres-ish units the exporter wrote), taken with
 * three.js itself — not hand estimates. They do three jobs:
 *
 *   MODEL_HEIGHT — rendered height in the file's own units, so the wrapper
 *     can normalise any base to the shopper's metric height. Without this a
 *     base renders at whatever unit height the exporter wrote and the camera
 *     framing (built for a metric body) is wrong.
 *   MODEL_OFFSET — recenters feet to the origin (the exports carry a small
 *     Blender scene offset; an off-centre avatar orbits like a wobbling top).
 *   HEAD_ANCHOR — head centre in model space, where a canonical-space
 *     hairstyle's origin lands. One hair set fits every base because only
 *     this anchor moves per model.
 */

import type { Gender } from "./sizing";
export interface AvatarModelSpec {
  /** Public URL of the base body. */
  url: string;
  /** Rendered height in model units (bind pose). */
  height: number;
  /** Added to the wrapper so feet sit at the origin, centred. */
  offset: [number, number, number];
  /** Head centre in model space: the hair origin lands here. */
  headAnchor: [number, number, number];
  /** Bone that carries the head (hair parent). */
  headBone: RegExp;
}

/**
 * Head anchor per base: the CENTRE of the skull, which is where a hairpiece's
 * origin (the centre of the cap it was modelled around) must land.
 *
 * Measured by scripts/measure-skull.mjs from the head-joint-weighted vertices
 * of each file, skinned into world space:
 *
 *   female  skull centre [0.043, 0.859, -0.166]  half [0.179, 0.185, 0.177]
 *   male    skull centre [0.042, 0.859, -0.231]  half [0.179, 0.185, 0.177]
 *   child   skull centre [0.031, 0.518, -0.117]  half [0.130, 0.134, 0.128]
 *
 * The male anchor is NOT the female anchor with a different height: the two
 * bases are the same build rotated into different poses, so the skull sits a
 * full 6cm further back. Reusing one anchor for both put every male
 * hairpiece half a head behind the skull, where nothing catches the light.
 *
 * The anchor must be the skull CENTRE, not its crown. Anchoring at the crown
 * lifts the cap's own radius clear of the head, and the hair then floats above
 * the skull — which reads on screen as "the avatar has no hair".
 */
export const AVATAR_MODELS = {
  female: {
    url: "/models/female_base.glb",
    height: 1.065,
    offset: [-0.05, 0, 0.11],
    headAnchor: [0.0426, 0.8586, -0.1664],
    headBone: /^head$/i,
  },
  male: {
    url: "/models/male_base.glb",
    height: 1.111,
    offset: [-0.05, 0, 0.15],
    headAnchor: [0.0418, 0.8586, -0.2314],
    headBone: /^head$/i,
  },
  child: {
    url: "/models/child_base.glb",
    height: 0.809,
    offset: [-0.038, 0, 0.085],
    headAnchor: [0.0314, 0.518, -0.1171],
    headBone: /^head$/i,
  },
} as const satisfies Record<string, AvatarModelSpec>;

export type AvatarModelKey = keyof typeof AVATAR_MODELS;

/** Which base a shopper gets. Kids share one unisex base. */
export function avatarModelKeyFor(gender: Gender): AvatarModelKey {
  if (gender === "MALE") return "male";
  if (gender === "FEMALE") return "female";
  return "child";
}

export function avatarModelFor(gender: Gender): AvatarModelSpec {
  return AVATAR_MODELS[avatarModelKeyFor(gender)];
}

/** Default body URL for a gender, or null when the caller overrides. */
export function defaultAvatarModelUrl(gender: Gender): string {
  return avatarModelFor(gender).url;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

export const HAIR_MODEL_URLS = {
  bun: "/models/hair/bun.glb",
  long: "/models/hair/long.glb",
  braid: "/models/hair/braid.glb",
  short: "/models/hair/short.glb",
  turban: "/models/hair/turban.glb",
} as const;

export type HairStyleId = keyof typeof HAIR_MODEL_URLS;

/** Hair GLB for a style id, or null for 'none'/unknown (built-in hair shows). */
export function hairModelUrl(
  styleId: string | null | undefined,
): string | null {
  if (!styleId || styleId === "none") return null;
  return (HAIR_MODEL_URLS as Record<string, string>)[styleId] ?? null;
}

/** True when the avatar should wear an attached hairpiece. */
export function wearsHairpiece(styleId: string | null | undefined): boolean {
  return hairModelUrl(styleId) !== null;
}
