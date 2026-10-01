/**
 * GLB avatar loading with a procedural fallback.
 *
 * This is the Phase 2 path: authored `.glb` bodies driven by the SAME
 * BodyParams the procedural body uses. Everything downstream — GarmentMesh,
 * the fit scorer, the size recommender — is unchanged, because this component
 * takes the identical props as ParametricAvatar.
 *
 * WHY NOT JUST `useGLTF` AND SCALE THE MESH
 * ------------------------------------------
 * Uniformly scaling a human mesh is wrong. `scale={[waistScale, 1, hipScale]}`
 * on the root stretches the head, neck and arms along with the torso, and
 * produces a barrel-shaped body for anyone whose bust and hip differ.
 * Anthropometry is regional, so a real parametric rig scales BONES, each
 * normalised against the rig's own rest measurements.
 *
 * Artist contract (see docs/GLB-PIPELINE.md):
 *   Bone names are matched case-insensitively, in this priority order:
 *     hips     -> hip girth        spine    -> waist depth
 *     chest    -> bust/chest girth  shoulder -> shoulder width
 *     upperArmL/R -> limb girth      thighL/R -> limb girth
 *   Absent bones are skipped, so a partial rig still works.
 *
 * Everything degrades: no URL -> procedural; 404 -> procedural; loads but has
 * no recognisable bones -> procedural. The shopper always sees a body.
 */

import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { Bone, Group, Material, Mesh, SkinnedMesh } from 'three';
import { SkeletonUtils } from 'three-stdlib';

import { ParametricAvatar, deriveMetrics, type AvatarMetrics } from './ParametricAvatar';
import type { BodyParams } from '@/lib/sizing';
import { computeBoneScales, roleForBone, RIG_REST } from '@/lib/rig';

export interface AvatarAssetProps {
  body: BodyParams;
  skinToneHex: string;
  hairStyleId: string;
  hairColorHex: string;
  /** GLB URL. When absent or broken, the procedural body is used. */
  modelUrl?: string | null;
  /** Fires once a GLB is actually applied, for analytics/debugging. */
  onModelLoaded?: (loaded: boolean) => void;
}

export function AvatarAsset(props: AvatarAssetProps) {
  // Destructure explicitly: spreading `props` into useGLTF widens the URL type
  // to `string | null | undefined`, which useGLTF will not accept.
  const { modelUrl, ...rest } = props;
  if (!modelUrl) return <Procedural {...rest} />;
  return (
    <AssetErrorBoundary fallback={<Procedural {...rest} />}>
      <Suspense fallback={<Procedural {...rest} />}>
        <LoadedGlbAvatar {...rest} modelUrl={modelUrl} />
      </Suspense>
    </AssetErrorBoundary>
  );
}

function Procedural(props: AvatarAssetProps) {
  return (
    <ParametricAvatar
      body={props.body}
      skinToneHex={props.skinToneHex}
      hairStyleId={props.hairStyleId}
      hairColorHex={props.hairColorHex}
    />
  );
}

/**
 * `useGLTF` rejects on a 404, and a rejected suspense promise inside R3F would
 * otherwise blank the viewport. Catching it means a missing asset degrades to
 * the procedural body instead of a black screen.
 */
class AssetErrorBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A missing 3D asset is a content problem, not an application crash.
    console.warn('[AvatarAsset] GLB failed to load, using procedural body:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** LoadedGlbAvatar is only ever rendered with a non-null URL. */
type LoadedProps = Omit<AvatarAssetProps, 'modelUrl'> & { modelUrl: string };

function LoadedGlbAvatar({ body, skinToneHex, modelUrl, onModelLoaded }: LoadedProps) {
  const { scene } = useGLTF(modelUrl) as { scene: THREE.Object3D };

  // Clone so two avatars on screen (compare mode) never share transforms, and
  // so a re-render cannot mutate the cached scene that useGLTF holds.
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

  // Retint the skin material. Traverse rather than guessing `materials.Skin`:
  // real exports name materials inconsistently or use an array.
  useEffect(() => {
    const colour = new THREE.Color(skinToneHex);
    clone.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as Material | Material[];
      for (const entry of Array.isArray(mat) ? mat : [mat]) {
        if (entry && 'color' in entry) (entry as THREE.MeshStandardMaterial).color.copy(colour);
      }
    });
  }, [clone, skinToneHex]);

  const metrics = useMemo(() => deriveMetrics(body), [body]);
  const scales = useMemo(() => computeBoneScales(body), [body]);

  // Apply bone scales in an effect, not in useFrame: a slider drag would
  // otherwise rewrite the rig 60 times a second.
  useEffect(() => {
    if (!root.current) return;
    root.current.traverse((o) => {
      const bone = o as Bone;
      if (!bone.isBone) return;
      const role = roleForBone(bone.name);
      if (!role) return;
      const [x, y, z] = scales[role];
      // Scale the BONE, not the mesh: children inherit, so the torso and both
      // arms move together and the skeleton stays connected.
      bone.scale.set(x, y, z);
    });
    root.current.updateMatrixWorld(true);
  }, [scales]);

  // Compensate for overall height once at the root so the rig stays 1 unit tall
  // and the camera framing in FittingRoomCanvas remains valid.
  const heightScale = metrics.height / (RIG_REST.heightCm / 100);

  useEffect(() => {
    onModelLoaded?.(true);
  }, [onModelLoaded]);

  return (
    <group ref={root} scale={[heightScale, heightScale, heightScale]}>
      <primitive object={clone} />
    </group>
  );
}

/** Warm the loader cache for a model before the shopper opens the studio. */
export function preloadAvatar(url: string) {
  try {
    useGLTF.preload(url);
  } catch {
    // Preload is an optimisation; a failure here must never break the page.
  }
}
