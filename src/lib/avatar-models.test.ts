/**
 * Avatar base + hair mapping tests (pure functions, no WebGL).
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assetFilename,
  AVATAR_MODELS,
  avatarModelFor,
  avatarModelKeyFor,
  defaultAvatarModelUrl,
  hairModelUrl,
  resolveModelSpec,
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

// --- Resolving a spec from a URL -------------------------------------------
//
// These exist because the previous lookup matched on the FULL URL, so serving
// the assets from a CDN — the obvious move for binaries, and what .gitignore
// forces — silently dropped every model onto the unknown-asset default. That
// renders at the wrong scale with a zero offset, which reads as a broken
// renderer rather than a failed lookup.

test("a bundled URL resolves to its own measured spec", () => {
  for (const [key, spec] of Object.entries(AVATAR_MODELS)) {
    const resolved = resolveModelSpec(spec.url, "FEMALE");
    assert.equal(resolved.url, spec.url);
    assert.equal(resolved.height, spec.height);
    assert.deepEqual(resolved.headAnchor, spec.headAnchor);
    void key;
  }
});

test("an absolute CDN URL keeps the measured height and anchor", () => {
  const bundled = AVATAR_MODELS.female;
  const cdn = "https://cdn.vemporium.com/v2/female_base.glb";
  const resolved = resolveModelSpec(cdn, "FEMALE");

  // Same ASSET, different host: the measurements must travel with it.
  assert.equal(resolved.url, cdn);
  assert.equal(resolved.height, bundled.height);
  assert.deepEqual(resolved.headAnchor, bundled.headAnchor);
  assert.deepEqual(resolved.offset, bundled.offset);
  // The fallback would have been height 1.7 and a zero offset.
  assert.notEqual(resolved.height, 1.7);
});

test("a cache-busting query string does not break the lookup", () => {
  const bundled = AVATAR_MODELS.male;
  const resolved = resolveModelSpec("/models/male_base.glb?v=3", "MALE");
  assert.equal(resolved.height, bundled.height);
});

test("a fragment does not break the lookup", () => {
  assert.equal(
    resolveModelSpec("/models/child_base.glb#rig", "KID_GIRL").height,
    AVATAR_MODELS.child.height,
  );
});

test("each base is found by its own file, not another's", () => {
  assert.equal(
    resolveModelSpec("https://x.test/child_base.glb", "FEMALE").height,
    AVATAR_MODELS.child.height,
  );
  assert.equal(
    resolveModelSpec("https://x.test/male_base.glb", "FEMALE").height,
    AVATAR_MODELS.male.height,
  );
});

test("a genuinely unknown model falls back to metres and a zero offset", () => {
  const resolved = resolveModelSpec("https://x.test/someone-elses-model.glb", "MALE");
  assert.equal(resolved.url, "https://x.test/someone-elses-model.glb");
  assert.equal(resolved.height, 1.7);
  assert.deepEqual(resolved.offset, [0, 0, 0]);
});

test("an unknown model still borrows a head anchor rather than crashing", () => {
  // The hair attachment needs an anchor even for a model we have not measured,
  // so falling back to the gender base keeps hair roughly on the skull.
  const resolved = resolveModelSpec("https://x.test/unknown.glb", "MALE");
  assert.deepEqual(resolved.headAnchor, AVATAR_MODELS.male.headAnchor);
  assert.ok(resolved.headBone instanceof RegExp);
});

test("an empty URL does not throw", () => {
  assert.doesNotThrow(() => resolveModelSpec("", "FEMALE"));
});
test("assetFilename returns the last path segment", () => {
  assert.equal(assetFilename("/models/hair/bun.glb"), "bun.glb");
  assert.equal(assetFilename("https://cdn.test/a/b/c.glb"), "c.glb");
});

test("assetFilename ignores query strings and fragments", () => {
  assert.equal(assetFilename("https://cdn.test/a/b/c.glb?v=1"), "c.glb");
  assert.equal(assetFilename("https://cdn.test/a/b/c.glb#x"), "c.glb");
  assert.equal(assetFilename("/models/f.glb?v=1#y"), "f.glb");
});

test("assetFilename returns null when there is no model file", () => {
  // A bare origin ends in a hostname; treating it as a filename would be a
  // lookup that can never succeed.
  assert.equal(assetFilename(""), null);
  assert.equal(assetFilename("/"), null);
  assert.equal(assetFilename("https://cdn.test/"), null);
  assert.equal(assetFilename("https://cdn.test"), null);
  assert.equal(assetFilename("https://cdn.test/models"), null);
});
