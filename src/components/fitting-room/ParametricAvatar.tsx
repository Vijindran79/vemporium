"use client";

/**
 * Parametric avatar body.
 *
 * Built from lathe/capsule primitives rather than a loaded GLB so the body
 * genuinely re-generates from the shopper's measurements every time a slider
 * moves — which is what makes the size recommendation trustworthy. When
 * authored GLB bodies land (Phase 2), swap <ProceduralBody/> for the loaded
 * mesh and feed the same BodyParams through the morph-target rig; this
 * component's public props do not change, so Garment.tsx and the draping maths
 * are unaffected.
 *
 * Units: 1 three.js unit = 1 metre.
 */

import { useMemo } from "react";
import * as THREE from "three";
import type { BodyParams } from "@/lib/sizing";
import { isKid, isMens } from "@/lib/sizing";

export interface AvatarMetrics {
  /** Overall height in metres. */
  height: number;
  /** Head centre height, used to place hair. */
  headY: number;
  shoulderHalf: number;
  chestRadius: number;
  waistRadius: number;
  hipRadius: number;
  upperArmRadius: number;
  thighRadius: number;
  limbLength: number;
  /** Fraction of height taken by the legs, drives hem placement. */
  legRatio: number;
  hipY: number;
  shoulderY: number;
}

const CM = 0.01; // cm -> metres

/**
 * Derives renderable proportions from measurements.
 *
 * Anthropometry is non-linear: a 5cm height change moves the hip far more than
 * the waist, and radius is half the girth. These ratios are the simplified
 * anthropo multipliers used in apparel sizing — good enough to judge drape, and
 * clearly better than uniformly scaling a mesh.
 */
export function deriveMetrics(body: BodyParams): AvatarMetrics {
  const height = body.heightCm * CM;
  const kid = isKid(body.gender);

  // CIRCUMFERENCE -> RADIUS DIVIDES BY 2*pi, NOT BY 2.
  //
  // Measuring a girth as a diameter makes every radius pi times too big: a
  // 90cm bust becomes a 45cm radius instead of 14.3cm, which renders as a
  // 2.8m-wide barrel. This bug was invisible while the procedural body was
  // the only thing on screen (it was fat AND short, so it read as "stylised"),
  // but the moment a correctly-proportioned GLB body appeared underneath, the
  // draped garments dwarfed it. Every radius below must be girth / 2pi.
  const R = 1 / (2 * Math.PI);
  const girth = isMens(body.gender)
    ? (body.chestCm ?? body.bustCm ?? 96)
    : (body.bustCm ?? 90);
  const bust = girth * CM * R;
  const waist = body.waistCm * CM * R;
  const hip = body.hipCm * CM * R;

  const legRatio = kid ? 0.52 : isMens(body.gender) ? 0.47 : 0.49;

  // Shoulders track chest, but not linearly.
  const shoulderHalf = bust * 1.28;
  const chestRadius = bust * 0.94;
  const waistRadius = Math.max(waist, bust * 0.72);
  const hipRadius = Math.max(hip, waist * 1.12);

  // Limb girths scale off the torso, not off weight, so a tall lean person does
  // not end up with tree-trunk arms. The reference is the radius implied by
  // the rest-pose hip girths from rig.ts (95cm adult, 65cm child), so a body
  // matching the rest pose returns exactly 1.0.
  const refHipRadius = (kid ? 65 : 95) * CM * R;
  const massFactor = Math.min(1.35, Math.max(0.72, hip / refHipRadius));

  return {
    height,
    headY: height * 0.93,
    shoulderHalf,
    chestRadius,
    waistRadius,
    hipRadius,
    upperArmRadius: chestRadius * 0.34 * massFactor,
    thighRadius: hipRadius * 0.78 * massFactor,
    limbLength: height * (1 - legRatio) * 0.52,
    legRatio,
    hipY: height * 0.46,
    shoulderY: height * 0.765,
  };
}

/** Smooth torso profile revolved into a body — the base for every garment. */
function torsoProfile(m: AvatarMetrics): THREE.Vector2[] {
  const { height } = m;
  const pts: THREE.Vector2[] = [];
  const add = (yFrac: number, r: number) =>
    pts.push(new THREE.Vector2(r, height * yFrac));

  add(0.02, m.hipRadius * 0.86); // upper thigh junction
  add(0.12, m.hipRadius * 1.0);
  add(0.26, m.hipRadius * 0.97);
  add(0.38, m.waistRadius * 1.06); // natural waist
  add(0.46, m.waistRadius * 1.12);
  add(0.58, m.chestRadius * 1.0); // bust / chest apex
  add(0.68, m.chestRadius * 0.99);
  add(0.78, m.chestRadius * 0.86); // shoulder line
  add(0.84, m.chestRadius * 0.72);
  add(0.88, m.chestRadius * 0.5); // neck base
  add(0.9, m.chestRadius * 0.26);
  return pts;
}

/** Tapered limb: a capsule with a per-vertex radial scale. */
function limb(
  radius: number,
  length: number,
  taper = 0.7,
): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, length, 6, 14);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + length / 2) / length; // 0 at the bottom, 1 at the top
    const scale = taper + (1 - taper) * t;
    pos.setX(i, pos.getX(i) * scale);
    pos.setZ(i, pos.getZ(i) * scale);
  }
  g.computeVertexNormals();
  return g;
}

export interface ParametricAvatarProps {
  body: BodyParams;
  skinToneHex: string;
  hairStyleId: string;
  hairColorHex: string;
}

export function ParametricAvatar({
  body,
  skinToneHex,
  hairStyleId,
  hairColorHex,
}: ParametricAvatarProps) {
  const m = useMemo(() => deriveMetrics(body), [body]);

  const skin = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: skinToneHex,
        roughness: 0.72,
        metalness: 0.02,
      }),
    [skinToneHex],
  );
  const hairMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: hairColorHex, roughness: 0.85 }),
    [hairColorHex],
  );

  const geometries = useMemo(() => {
    const torso = new THREE.LatheGeometry(torsoProfile(m), 32);
    torso.computeVertexNormals();
    return {
      torso,
      head: new THREE.SphereGeometry(m.chestRadius * 0.56, 24, 20),
      arm: limb(m.upperArmRadius, m.limbLength * 1.02),
      leg: limb(m.thighRadius, m.limbLength * 1.05),
    };
  }, [m]);

  const headR = m.chestRadius * 0.56;
  const armX = m.shoulderHalf * 0.92;
  const legX = m.hipRadius * 0.46;

  return (
    <group>
      {/* torso */}
      <mesh
        geometry={geometries.torso}
        material={skin}
        castShadow
        receiveShadow
      />

      {/* head + neck */}
      <mesh
        position={[0, m.headY, 0]}
        geometry={geometries.head}
        material={skin}
        castShadow
      />
      <mesh position={[0, m.height * 0.875, 0]} material={skin} castShadow>
        <cylinderGeometry
          args={[headR * 0.42, headR * 0.5, m.height * 0.06, 16]}
        />
      </mesh>

      {/* arms */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * armX, m.shoulderY, 0]}>
          <mesh geometry={geometries.arm} material={skin} castShadow />
          <mesh
            position={[0, -m.limbLength * 0.51 - m.upperArmRadius * 0.9, 0]}
            material={skin}
            castShadow
          >
            <sphereGeometry args={[m.upperArmRadius * 1.05, 14, 12]} />
          </mesh>
        </group>
      ))}

      {/* legs */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * legX, m.hipY, 0]}>
          <mesh geometry={geometries.leg} material={skin} castShadow />
          <mesh
            position={[
              0,
              -m.limbLength * 0.525 - m.thighRadius * 0.8,
              m.thighRadius * 0.9,
            ]}
            material={skin}
            castShadow
          >
            <boxGeometry
              args={[
                m.thighRadius * 1.5,
                m.thighRadius * 1.1,
                m.thighRadius * 3.1,
              ]}
            />
          </mesh>
        </group>
      ))}

      <Hair
        style={hairStyleId}
        headR={headR}
        headY={m.headY}
        material={hairMat}
      />
    </group>
  );
}

function Hair({
  style,
  headR,
  headY,
  material,
}: {
  style: string;
  headR: number;
  headY: number;
  material: THREE.Material;
}) {
  if (style === "none") return null;

  const cap = (
    <mesh
      position={[0, headY + headR * 0.12, 0]}
      material={material}
      castShadow
    >
      <sphereGeometry
        args={[headR * 1.04, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58]}
      />
    </mesh>
  );

  switch (style) {
    case "bun":
      return (
        <group>
          {cap}
          <mesh
            position={[0, headY + headR * 0.95, -headR * 0.55]}
            material={material}
            castShadow
          >
            <sphereGeometry args={[headR * 0.52, 16, 14]} />
          </mesh>
        </group>
      );
    case "long":
      return (
        <group>
          {cap}
          <mesh
            position={[0, headY - headR * 1.5, -headR * 0.18]}
            material={material}
            castShadow
          >
            <capsuleGeometry args={[headR * 0.82, headR * 2.1, 4, 16]} />
          </mesh>
        </group>
      );
    case "braid":
      return (
        <group>
          {cap}
          <mesh
            position={[0, headY - headR * 0.9, -headR * 0.75]}
            rotation={[0.3, 0, 0]}
            material={material}
            castShadow
          >
            <capsuleGeometry args={[headR * 0.36, headR * 2.2, 4, 12]} />
          </mesh>
        </group>
      );
    case "turban":
      return (
        <group>
          <mesh
            position={[0, headY + headR * 0.3, 0]}
            material={material}
            castShadow
          >
            <sphereGeometry
              args={[headR * 1.22, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]}
            />
          </mesh>
          <mesh position={[0, headY + headR * 0.52, 0]} material={material}>
            <torusGeometry args={[headR * 0.8, headR * 0.16, 10, 24]} />
          </mesh>
        </group>
      );
    case "short":
    default:
      return cap;
  }
}
