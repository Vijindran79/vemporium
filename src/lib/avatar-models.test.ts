/**
 * Avatar base + hair mapping tests (pure functions, no WebGL).
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  AVATAR_MODELS,
  avatarModelFor,
  avatarModelKeyFor,
  defaultAvatarModelUrl,
  hairModelUrl,
  wearsHairpiece,
} from "./avatar-models.ts";
import { roleForBone } from "./rig.ts";

test("every gender resolves to a bundled base URL", () => {
  assert.equal(avatarModelKeyFor("FEMALE"), "female");
  assert.equal(avatarModelKeyFor("MALE"), "male");
  assert.equal(avatarModelKeyFor("KID_BOY"), "child");
  assert.equal(avatarModelKeyFor("KID_GIRL"), "child");
  for (const gender of ["FEMALE", "MALE", "KID_BOY", "KID_GIRL"] as const) {
    const url = defaultAvatarModelUrl(gender);
    assert.match(
      url,
      /^\/models\/\w+_base\.glb$/,
      `${gender} must map at a bundled base`,
    );
    assert.equal(avatarModelFor(gender).url, url);
  }
});

test("model constants are sane numbers, distinct per base", () => {
  const seen = new Set<string>();
  for (const [key, m] of Object.entries(AVATAR_MODELS)) {
    assert.ok(
      m.height > 0.3 && m.height < 3,
      `${key}: height ${m.height} is not human-scale`,
    );
    for (const v of [...m.offset, ...m.headAnchor])
      assert.ok(Number.isFinite(v), `${key}: non-finite constant`);
    // The anchor must sit above the midpoint: hair belongs on the head, and a
    // copy-paste slip here would plant it in the torso.
    assert.ok(
      m.headAnchor[1] > m.height / 2,
      `${key}: head anchor below mid-body`,
    );
    // The anchor must be inside the model's own vertical extent, or the hair
    // floats above the skull instead of sitting on it.
    assert.ok(
      m.headAnchor[1] < m.height,
      `${key}: head anchor (${m.headAnchor[1]}) is above model height (${m.height})`,
    );
  }
});

test("every anchor sits at its base's measured skull centre", () => {
  // Anchors are MEASURED (scripts/measure-skull.mjs), not derived by scaling one
  // base to another. That matters: the male base is the same build in a
  // different pose, so its skull sits 6cm further back, and reusing the female
  // anchor there placed every male hairpiece half a head behind the skull.
  //
  // These are the measured centres. Re-run the script when swapping a model and
  // update both this table and avatar-models.ts together.
  const MEASURED = {
    female: [0.0426, 0.8586, -0.1664],
    male: [0.0418, 0.8586, -0.2314],
    child: [0.0314, 0.518, -0.1171],
  };
  for (const [key, centre] of Object.entries(MEASURED)) {
    const anchor = AVATAR_MODELS[key as keyof typeof AVATAR_MODELS].headAnchor;
    for (const axis of [0, 1, 2]) {
      assert.ok(
        Math.abs(anchor[axis] - centre[axis]) < 1e-3,
        `${key} anchor axis ${axis}: ${anchor[axis]} != measured ${centre[axis]}`,
      );
    }
  }
  // The male skull is further back than the female one. If these ever match,
  // one of the two anchors was copy-pasted.
  assert.ok(
    AVATAR_MODELS.male.headAnchor[2] < AVATAR_MODELS.female.headAnchor[2] - 0.03,
    "the male skull sits further back than the female one — anchors must differ in z",
  );
});

test("hairstyle ids map to hair files; none/unknown map to null", () => {
  assert.equal(hairModelUrl("bun"), "/models/hair/bun.glb");
  assert.equal(hairModelUrl("long"), "/models/hair/long.glb");
  assert.equal(hairModelUrl("braid"), "/models/hair/braid.glb");
  assert.equal(hairModelUrl("short"), "/models/hair/short.glb");
  assert.equal(hairModelUrl("turban"), "/models/hair/turban.glb");
  assert.equal(hairModelUrl("none"), null);
  assert.equal(hairModelUrl(null), null);
  assert.equal(hairModelUrl(undefined), null);
  assert.equal(hairModelUrl("mohawk"), null);
  assert.equal(wearsHairpiece("bun"), true);
  assert.equal(wearsHairpiece("none"), false);
});

test("head and neck never match a bone role, on any naming convention", () => {
  // Facial proportions must survive every body slider.
  for (const name of [
    "Head",
    "Neck",
    "mixamorig:Head",
    "mixamorig:Neck",
    "head_01",
    "neck_01",
  ]) {
    assert.equal(roleForBone(name), null, `${name} must not scale`);
  }
});

test("the waist segment resolves on Quaternius naming", () => {
  assert.equal(roleForBone("Abdomen"), "spine");
  assert.equal(roleForBone("mixamorig:Spine"), "spine");
});
