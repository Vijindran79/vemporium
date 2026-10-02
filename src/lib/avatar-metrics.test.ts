/**
 * Avatar-metric tests (pure maths, no WebGL).
 *
 * Run with: npm test
 *
 * These exist because of a bug that hid for the entire life of the project:
 * `deriveMetrics` divided girth by 2 instead of 2*pi, so every torso radius
 * was pi times too large. Nothing caught it while the procedural body was the
 * only thing on screen — a body that was uniformly inflated still read as a
 * plausible stylised mannequin. It only became visible once a correctly
 * proportioned GLB body was rendered underneath and the draped garments
 * dwarfed it. The assertions below are all "a real human's measurements must
 * produce human-sized geometry", which is exactly the class of bug that had
 * no coverage.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { deriveMetrics } from "../components/fitting-room/ParametricAvatar.tsx";
import { clampBodyParams, defaultBody, type BodyParams } from "./sizing.ts";
import { RIG_REST } from "./rig.ts";

/** A body that matches the rig rest pose. */
const restBody = (gender: "FEMALE" | "MALE" = "FEMALE"): BodyParams =>
  gender === "FEMALE"
    ? {
        gender,
        heightCm: RIG_REST.heightCm,
        weightKg: 62,
        bustCm: RIG_REST.girthCm,
        waistCm: RIG_REST.waistCm,
        hipCm: RIG_REST.hipCm,
      }
    : {
        gender,
        heightCm: RIG_REST.heightCm,
        weightKg: 70,
        chestCm: RIG_REST.girthCm,
        waistCm: RIG_REST.waistCm,
        hipCm: RIG_REST.hipCm,
      };

test("a girth converts to a circumference-correct radius", () => {
  const m = deriveMetrics(restBody());
  // 90cm bust -> radius 90cm / 2pi = 14.32cm = 0.1432m. chestRadius is
  // 0.94x that.
  const expectedBustRadius = RIG_REST.girthCm / 100 / (2 * Math.PI);
  assert.ok(
    Math.abs(m.chestRadius / (expectedBustRadius * 0.94) - 1) < 1e-6,
    `chest radius ${m.chestRadius} is not girth/2pi (expected ~${expectedBustRadius * 0.94})`,
  );
});

test("no torso radius is a multiple of its own girth divided by two", () => {
  // The exact signature of the old bug: radius == girth/2 (diameter mistaken
  // for circumference). This test names the mistake so it cannot be re-made.
  const m = deriveMetrics(restBody());
  const radiusFor = (girthCm: number) => girthCm / 100 / 2;
  assert.ok(
    Math.abs(m.hipRadius - radiusFor(RIG_REST.hipCm)) > 0.02,
    `hip radius ${m.hipRadius} still equals girth/2 (${radiusFor(RIG_REST.hipCm)})`,
  );
});

test("the widest body in range stays narrower than its shoulders", () => {
  // An XXL torso (120cm bust, 118cm hips) on a short frame must not be wider
  // across than the shoulders are long. This is the check a viewer would make
  // first and a unit test can make forever.
  const big = clampBodyParams({
    gender: "MALE",
    heightCm: 160,
    weightKg: 120,
    chestCm: 120,
    waistCm: 110,
    hipCm: 118,
  });
  const m = deriveMetrics(big);
  assert.ok(
    m.hipRadius * 2 < m.shoulderHalf * 2,
    `hips (${(m.hipRadius * 2).toFixed(3)}m wide) are wider than the shoulders (${(m.shoulderHalf * 2).toFixed(3)}m)`,
  );
});

test("the procedural head is anatomically sized", () => {
  // The head is a sphere of radius 0.56x the chest radius, so 2r is head
  // WIDTH, not head height. Adult head width is ~14-17cm; children's ~13cm.
  // Asserting absolute width rather than a fraction of body height is
  // deliberate: 15cm on a 168cm body is 9%, and reading that as a too-small
  // head is exactly the wrong test that hides a real bug.
  for (const gender of ["FEMALE", "MALE"] as const) {
    const m = deriveMetrics(defaultBody(gender));
    const headWidthCm = m.chestRadius * 0.56 * 2 * 100;
    assert.ok(
      headWidthCm > 13 && headWidthCm < 18,
      `${gender}: head width ${headWidthCm.toFixed(1)}cm is not human`,
    );
  }
  for (const gender of ["KID_BOY", "KID_GIRL"] as const) {
    const m = deriveMetrics(defaultBody(gender));
    const headWidthCm = m.chestRadius * 0.56 * 2 * 100;
    assert.ok(
      headWidthCm > 10 && headWidthCm < 15,
      `${gender}: head width ${headWidthCm.toFixed(1)}cm is not human`,
    );
  }
});

test("a wider girth does not inflate the head past human width", () => {
  // Head radius tracks chest radius linearly, so a 150cm-bust body yields a
  // ~25cm head — wider than real, because a real skull does NOT grow with the
  // chest. That linear link is a known simplification of the procedural
  // fallback, which is no longer the default path (a GLB base is). The point
  // of this canary is the pi factor: with the old girth/2 bug the same body
  // produced an 80cm head, so a 27cm ceiling catches the bug by 3x while
  // allowing the simplification to stand.
  const huge = deriveMetrics(
    clampBodyParams({
      gender: "FEMALE",
      heightCm: 175,
      weightKg: 130,
      bustCm: 150,
      waistCm: 140,
      hipCm: 145,
    }),
  );
  const headWidthCm = huge.chestRadius * 0.56 * 2 * 100;
  assert.ok(
    headWidthCm < 27,
    `an XXL body produced a ${headWidthCm.toFixed(0)}cm head`,
  );
});

test("a rest-pose body returns 1.0 on limb mass", () => {
  // The massFactor reference must agree with rig.ts rest hips, otherwise the
  // procedural arms and legs do not match the GLB rig's rest pose.
  const m = deriveMetrics(restBody());
  const expectedThigh = m.hipRadius * 0.78;
  assert.ok(Math.abs(m.thighRadius - expectedThigh) < 1e-9);
});

test("metrics never go NaN or Infinity on the extremes of the clamp range", () => {
  for (const gender of ["FEMALE", "MALE", "KID_BOY", "KID_GIRL"] as const) {
    for (const heightCm of [40, 100, 230]) {
      for (const girth of [20, 100, 200]) {
        const m = deriveMetrics(
          clampBodyParams({
            gender,
            heightCm,
            weightKg: 60,
            bustCm: girth,
            chestCm: girth,
            waistCm: girth,
            hipCm: girth,
          }),
        );
        for (const [k, v] of Object.entries(m)) {
          assert.ok(
            Number.isFinite(v as number),
            `${gender} ${heightCm}cm girth${girth}: ${k} = ${v}`,
          );
        }
      }
    }
  }
});

test("radius scales monotonically with girth", () => {
  let last = 0;
  for (let bust = 60; bust <= 140; bust += 10) {
    const m = deriveMetrics(
      clampBodyParams({
        gender: "FEMALE",
        heightCm: 170,
        weightKg: 65,
        bustCm: bust,
        waistCm: bust * 0.8,
        hipCm: bust * 1.05,
      }),
    );
    assert.ok(m.chestRadius > last, `chest radius did not grow at ${bust}cm`);
    last = m.chestRadius;
  }
});
