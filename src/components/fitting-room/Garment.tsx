'use client';

/**
 * Garment draping.
 *
 * Each garment is generated as a lathe "shell" whose profile is derived from the
 * SAME AvatarMetrics the body uses, plus a drape offset. That is what makes the
 * fit look right: a 96cm-bust avatar gets a wider kurta than a 82cm-bust one,
 * and the hem clears the feet because the length is measured from the waist.
 *
 * Draping families map to the PRD:
 *   WRAPPED  (saree, dupatta) — asymmetric wrap with a pleated front panel
 *   RIGID    (kurta, sherwani) — near-cylindrical with a straight hem and placket
 *   FLOWING  (lehenga)         — pronounced conical flare with a heavy hem
 *
 * Fabric feel is approximated with material response (roughness/sheen) since a
 * full PBR fabric shader is out of scope for MVP.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { AvatarMetrics } from './ParametricAvatar';
import type { GarmentSpec } from '@/store/avatar-store';

const CM = 0.01;

interface FabricFeel {
  roughness: number;
  metalness: number;
  sheen: number;
}

const FABRIC_FEEL: Record<string, FabricFeel> = {
  SILK: { roughness: 0.28, metalness: 0.06, sheen: 0.9 },
  RAW_SILK: { roughness: 0.34, metalness: 0.04, sheen: 0.8 },
  BANARASI_BROCATTE: { roughness: 0.42, metalness: 0.3, sheen: 0.6 },
  VELVET: { roughness: 0.95, metalness: 0.0, sheen: 0.35 },
  CHIFFON: { roughness: 0.2, metalness: 0.0, sheen: 1.0 },
  GEORGETTE: { roughness: 0.55, metalness: 0.0, sheen: 0.5 },
  CHANDERI: { roughness: 0.5, metalness: 0.08, sheen: 0.55 },
  COTTON: { roughness: 0.88, metalness: 0.0, sheen: 0.12 },
  LINEN: { roughness: 0.94, metalness: 0.0, sheen: 0.08 },
};

const DEFAULT_FEEL: FabricFeel = { roughness: 0.6, metalness: 0.0, sheen: 0.4 };

/** Comfortable garment ease, in cm of girth added over the body. */
const EASE_CM = { chest: 8, waist: 10, hip: 12 };

export interface DrapeResult {
  geometry: THREE.BufferGeometry;
  /** Y coordinate of the hem. */
  hemY: number;
}

/**
 * Builds the lathe profile for a garment over the given body.
 * Radius at each level = body radius + ease + flare curve.
 */
function buildShell(m: AvatarMetrics, g: GarmentSpec, segments = 40): THREE.BufferGeometry {
  const waistY = m.height * 0.46;
  const hemY = Math.max(0.02, waistY - g.lengthCm * CM);
  const height = waistY - hemY;
  const flare = g.flare;

  const baseChest = m.chestRadius + EASE_CM.chest * CM * 0.5;
  const baseWaist = m.waistRadius + EASE_CM.waist * CM * 0.5;
  const baseHip = m.hipRadius + EASE_CM.hip * CM * 0.5;

  // Number of vertical rings. More rings = smoother drape, higher vertex count.
  const rings = 26;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings; // 0 at the hem, 1 at the top
    const y = hemY + height * t;

    // Interpolate the body radius at this height, then add the drape.
    const waistFrac = waistY / m.height;
    const yFrac = y / m.height;
    let bodyR: number;
    if (yFrac >= waistFrac) {
      // Above the waist: blend waist -> chest.
      const k = (yFrac - waistFrac) / Math.max(0.001, 0.78 - waistFrac);
      bodyR = baseWaist + (baseChest - baseWaist) * Math.min(1, k);
    } else {
      // Below the waist: blend hip -> waist.
      const k = (waistFrac - yFrac) / Math.max(0.001, waistFrac);
      bodyR = baseHip + (baseWaist - baseHip) * Math.min(1, k);
    }

    // Flare grows toward the hem; this is what makes a lehenga read as a
    // lehenga rather than a tube.
    const belowWaist = Math.max(0, waistFrac - yFrac) / Math.max(0.001, waistFrac);
    const flareRadius = flare * m.hipRadius * belowWaist * 2.4;

    // Slight waist suppression makes the garment read as "tailored" not "bag".
    const suppress = g.drapingType === 'RIGID' ? 0.92 : 1.0;

    pts.push(new THREE.Vector2(Math.max(0.02, (bodyR + flareRadius) * suppress), y));
  }

  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

export function useDrapeGeometry(m: AvatarMetrics, g: GarmentSpec): DrapeResult {
  return useMemo(() => {
    const waistY = m.height * 0.46;
    return {
      geometry: buildShell(m, g),
      hemY: Math.max(0.02, waistY - g.lengthCm * CM),
    };
  }, [m, g]);
}

export function fabricMaterial(g: GarmentSpec, side: THREE.Side = THREE.DoubleSide): THREE.MeshPhysicalMaterial {
  const feel = FABRIC_FEEL[g.fabric] ?? DEFAULT_FEEL;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(g.colourHex),
    roughness: feel.roughness,
    metalness: feel.metalness,
    sheen: feel.sheen,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(g.accentHex ?? g.colourHex).lerp(new THREE.Color('#ffffff'), 0.5),
    side,
  });
}

export interface GarmentMeshProps {
  metrics: AvatarMetrics;
  garment: GarmentSpec;
  /** Second garment for side-by-side comparison mode. */
  comparison?: boolean;
  onSelect?: () => void;
}

export function GarmentMesh({ metrics, garment, comparison = false, onSelect }: GarmentMeshProps) {
  const { geometry, hemY } = useDrapeGeometry(metrics, garment);
  const material = useMemo(() => fabricMaterial(garment), [garment]);
  const accent = useMemo(
    () => new THREE.MeshStandardMaterial({ color: garment.accentHex ?? '#C9A227', roughness: 0.35, metalness: 0.5 }),
    [garment],
  );

  const waistY = metrics.height * 0.46;
  const chestY = metrics.height * 0.6;
  const isWrapped = garment.drapingType === 'WRAPPED';

  return (
    <group>
      {/* main shell */}
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onClick={onSelect}
        onPointerOver={onSelect ? () => (document.body.style.cursor = 'pointer') : undefined}
        onPointerOut={onSelect ? () => (document.body.style.cursor = 'auto') : undefined}
      />

      {/* Hem band — a heavier border so the garment edge reads as stitched. */}
      <mesh position={[0, hemY + 0.004, 0]} rotation={[Math.PI / 2, 0, 0]} material={accent}>
        <torusGeometry args={[hemRadius(metrics, garment, hemY), 0.006, 8, 48]} />
      </mesh>

      {isWrapped && (
        <group>
          {/* Pleated front panel — the signature of a wrapped saree. */}
          <mesh position={[0, (waistY + hemY) / 2, radiusAt(metrics, garment, (waistY + hemY) / 2) * 0.98]} material={material} castShadow>
            <boxGeometry args={[metrics.hipRadius * 1.5, waistY - hemY, 0.012]} />
          </mesh>
          {/* Pallu over the shoulder. */}
          <mesh position={[metrics.shoulderHalf * 0.55, metrics.shoulderY + 0.02, 0.02]} rotation={[0, 0, -0.22]} material={material} castShadow>
            <boxGeometry args={[metrics.shoulderHalf * 0.9, 0.34, 0.008]} />
          </mesh>
          {/* Blouse block at the bust. */}
          <mesh position={[0, chestY, 0]} material={material}>
            <latheGeometry
              args={[
                [
                  new THREE.Vector2(metrics.chestRadius * 1.02, 0),
                  new THREE.Vector2(metrics.chestRadius * 1.06, 0.09),
                  new THREE.Vector2(metrics.chestRadius * 0.98, 0.18),
                ],
                28,
              ]}
            />
          </mesh>
        </group>
      )}

      {garment.drapingType === 'RIGID' && (
        <group>
          {/* Centre placket with buttons. */}
          <mesh position={[0, (chestY + waistY) / 2, metrics.chestRadius * 1.04]} material={accent}>
            <boxGeometry args={[0.012, chestY - waistY, 0.006]} />
          </mesh>
          {[0.78, 0.7, 0.62, 0.54].map((f) => (
            <mesh key={f} position={[0, metrics.height * f, metrics.chestRadius * 1.06]} material={accent}>
              <sphereGeometry args={[0.006, 10, 8]} />
            </mesh>
          ))}
          {/* Collar. */}
          <mesh position={[0, metrics.shoulderY + 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} material={accent}>
            <torusGeometry args={[metrics.chestRadius * 0.42, 0.008, 8, 24, Math.PI * 1.4]} />
          </mesh>
        </group>
      )}

      {garment.drapingType === 'FLOWING' && (
        <group>
          {/* Heavy kantha border bands on a flared lehenga. */}
          {[0.18, 0.3, 0.42].map((t, i) => (
            <mesh key={i} position={[0, hemY + (waistY - hemY) * t, 0]} rotation={[Math.PI / 2, 0, 0]} material={accent}>
              <torusGeometry args={[hemRadius(metrics, garment, hemY + (waistY - hemY) * t), 0.0045, 8, 56]} />
            </mesh>
          ))}
          {/* Waistband. */}
          <mesh position={[0, waistY, 0]} rotation={[Math.PI / 2, 0, 0]} material={accent}>
            <torusGeometry args={[metrics.waistRadius * 1.06, 0.012, 8, 40]} />
          </mesh>
        </group>
      )}

      {comparison && (
        // A faint ground disc helps the eye register two separate figures.
        <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[metrics.hipRadius * 1.4, metrics.hipRadius * 1.75, 48]} />
          <meshBasicMaterial color="#C9A227" transparent opacity={0.22} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/** Mirrors the shell's radius formula for decorative rings. */
function hemRadius(m: AvatarMetrics, g: GarmentSpec, y: number): number {
  const waistY = m.height * 0.46;
  const waistFrac = waistY / m.height;
  const yFrac = y / m.height;
  const baseWaist = m.waistRadius + EASE_CM.waist * CM * 0.5;
  const baseHip = m.hipRadius + EASE_CM.hip * CM * 0.5;
  const baseChest = m.chestRadius + EASE_CM.chest * CM * 0.5;

  let bodyR: number;
  if (yFrac >= waistFrac) {
    const k = (yFrac - waistFrac) / Math.max(0.001, 0.78 - waistFrac);
    bodyR = baseWaist + (baseChest - baseWaist) * Math.min(1, k);
  } else {
    const k = (waistFrac - yFrac) / Math.max(0.001, waistFrac);
    bodyR = baseHip + (baseWaist - baseHip) * Math.min(1, k);
  }
  const belowWaist = Math.max(0, waistFrac - yFrac) / Math.max(0.001, waistFrac);
  return bodyR + g.flare * m.hipRadius * belowWaist * 2.4 + 0.004;
}

function radiusAt(m: AvatarMetrics, g: GarmentSpec, y: number): number {
  return hemRadius(m, g, y);
}
