'use client';

/**
 * Real-garment overlay: binds an authored garment `.glb` to the parametric
 * avatar skeleton.
 *
 * The fitting room renders the shopper's body from BodyParams (procedural, or
 * a GLB rig via AvatarAsset). Before any garment GLB is authored, garments
 * render as procedural drape shells (GarmentMesh). This component is the Phase
 * 2 path: when `modelUrl` points at an authored garment model, the mesh is
 * loaded, cloned, and bound to the SAME skeleton the avatar uses, so it
 * follows the body rather than floating around it.
 *
 * Binding contract (mirrors AvatarAsset, see docs/GLB-PIPELINE.md):
 *   - The garment rig is authored against the same rest pose (RIG_REST), so
 *     the same per-bone scales from computeBoneScales apply verbatim. One
 *     maths path for body and garment means they can never disagree about
 *     what a 96cm bust means.
 *   - Bone names are matched with roleForBone; absent bones are skipped, so a
 *     rigid garment (kurta, sherwani) with no leg bones still binds.
 *   - No URL, 404, or unrecognised rig degrades to the procedural GarmentMesh,
 *     never a blank viewport. The shopper always sees a garment.
 */

import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { Bone, Group, Material, Mesh } from 'three';
import { SkeletonUtils } from 'three-stdlib';

import { deriveMetrics, type AvatarMetrics } from './ParametricAvatar';
import { GarmentMesh } from './Garment';
import { computeBoneScales, roleForBone } from '@/lib/rig';
import type { BodyParams } from '@/lib/sizing';
import type { GarmentSpec } from '@/store/avatar-store';

export interface GarmentOverlayProps {
  body: BodyParams;
  garment: GarmentSpec;
  /** Authored garment GLB. Absent or broken -> procedural drape stands in. */
  modelUrl?: string | null;
  /** Fires once a GLB is actually bound, for analytics/debugging. */
  onModelLoaded?: (loaded: boolean) => void;
  /** Fired when the shopper clicks the garment mesh in 3D. */
  onSelect?: () => void;
}

export function GarmentOverlay(props: GarmentOverlayProps) {
  const { modelUrl, ...rest } = props;
  const metrics = useMemo(() => deriveMetrics(props.body), [props.body]);
  if (!modelUrl) return <Procedural metrics={metrics} {...rest} body={props.body} />;
  return (
    <GarmentErrorBoundary fallback={<Procedural metrics={metrics} {...rest} body={props.body} />}>
      <Suspense fallback={<Procedural metrics={metrics} {...rest} body={props.body} />}>
        <BoundGarment metrics={metrics} {...props} modelUrl={modelUrl} />
      </Suspense>
    </GarmentErrorBoundary>
  );
}

function Procedural({
  metrics,
  garment,
  onSelect,
}: {
  body: BodyParams;
  metrics: AvatarMetrics;
  garment: GarmentSpec;
  onSelect?: () => void;
}) {
  return <GarmentMesh metrics={metrics} garment={garment} onSelect={onSelect} />;
}

/**
 * `useGLTF` rejects on a 404, and a rejected suspense promise inside R3F would
 * otherwise blank the viewport. Catching it means a missing garment asset
 * degrades to the procedural drape instead of a black screen.
 */
class GarmentErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A missing 3D asset is a content problem, not an application crash.
    console.warn('[GarmentOverlay] garment GLB failed to load, using procedural drape:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type BoundProps = Omit<GarmentOverlayProps, 'modelUrl'> & { modelUrl: string; metrics: AvatarMetrics };

function BoundGarment({ body, garment, metrics, modelUrl, onModelLoaded, onSelect }: BoundProps) {
  const { scene } = useGLTF(modelUrl) as { scene: THREE.Object3D };

  // Clone so compare mode (two garments on screen) never shares transforms,
  // and so a re-render cannot mutate the cached scene that useGLTF holds.
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const root = useRef<Group>(null);

  useEffect(() => {
    return () => {
      // The cache still owns `scene`; only the clone's overrides are ours.
      clone.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose?.();
      });
    };
  }, [clone]);

  // Tint the garment material to the selected colourway. Traverse rather than
  // guessing `materials.Fabric`: real exports name materials inconsistently
  // or use an array.
  useEffect(() => {
    const colour = new THREE.Color(garment.colourHex);
    clone.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as Material | Material[];
      for (const entry of Array.isArray(mat) ? mat : [mat]) {
        if (entry && 'color' in entry) (entry as THREE.MeshStandardMaterial).color.copy(colour);
      }
    });
  }, [clone, garment.colourHex]);

  const scales = useMemo(() => computeBoneScales(body), [body]);

  // Bind to the avatar skeleton: the same per-bone scales AvatarAsset applies
  // to the body, so garment and body agree about every measurement. Applied in
  // an effect, not in useFrame, so a slider drag does not rewrite the rig at
  // 60fps.
  useEffect(() => {
    if (!root.current) return;
    root.current.traverse((o) => {
      const bone = o as Bone;
      if (!bone.isBone) return;
      const role = roleForBone(bone.name);
      if (!role) return;
      const [x, y, z] = scales[role];
      // Scale the BONE, not the mesh: children inherit, so sleeves and hems
      // follow the torso and the garment stays connected.
      bone.scale.set(x, y, z);
    });
    root.current.updateMatrixWorld(true);
  }, [scales]);

  useEffect(() => {
    onModelLoaded?.(true);
  }, [onModelLoaded]);

  return (
    <group
      ref={root}
      onClick={onSelect}
      onPointerOver={onSelect ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = 'auto') : undefined}
    >
      <primitive object={clone} />
    </group>
  );
}

/** Warm the loader cache for a garment model before the shopper opens it. */
export function preloadGarment(url: string) {
  try {
    useGLTF.preload(url);
  } catch {
    // Preload is an optimisation; a failure here must never break the page.
  }
}

export type { AvatarMetrics };
