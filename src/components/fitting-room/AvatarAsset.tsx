"use client";

/**
 * Real-avatar rendering with a procedural fallback.
 *
 * Each gender/age gets a bundled base body (`public/models/*_base.glb`,
 * Quaternius CC0 — see docs/GLB-PIPELINE.md) instead of the old geometric
 * primitives. The body is still driven by the SAME BodyParams: per-bone
 * scales from `computeBoneScales` reshape torso and limbs while the head,
 * neck, hands and feet never match a role and keep their authored
 * proportions, and a normalising wrapper maps the file's unit height onto
 * the shopper's metric height so camera framing stays valid.
 *
 * Skin tone tints ONLY materials named *skin*: roughness, metalness and maps
 * are untouched, so ambient response and specular highlights survive — only
 * albedo moves. The face (eyes/mouth) keeps its authored colours. A selected
 * hairstyle hides the base's built-in hair mesh and attaches the matching
 * `public/models/hair/*.glb` piece at the model's head anchor, tinted with
 * the chosen hair colour.
 *
 * WHY NOT JUST `useGLTF` AND SCALE THE MESH
 * ------------------------------------------
 * Uniformly scaling a human mesh is wrong. `scale={[waistScale, 1, hipScale]}`
 * on the root stretches the head, neck and arms along with the torso, and
 * produces a barrel-shaped body for anyone whose bust and hip differ.
 * Anthropometry is regional, so a real parametric rig scales BONES, each
 * normalised against the rig's own rest measurements.
 *
 * Everything degrades: 404 -> procedural; loads but headless -> body without
 * hair; no recognised bones -> procedural. The shopper always sees a body.
 */

import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Bone, Group, Material, Mesh } from "three";
import { SkeletonUtils } from "three-stdlib";

import {
  ParametricAvatar,
  deriveMetrics,
  type AvatarMetrics,
} from "./ParametricAvatar";
import type { BodyParams } from "@/lib/sizing";
import { computeBoneScales, roleForBone } from "@/lib/rig";
import {
  AVATAR_MODELS,
  avatarModelFor,
  defaultAvatarModelUrl,
  hairModelUrl,
  type AvatarModelSpec,
} from "@/lib/avatar-models";

export interface AvatarAssetProps {
  body: BodyParams;
  skinToneHex: string;
  hairStyleId: string;
  hairColorHex: string;
  /**
   * Explicit body URL (e.g. a product's `modelAssetUrl`). When omitted the
   * bundled base for the shopper's gender/age is used — this is what replaced
   * the old procedural default.
   */
  modelUrl?: string | null;
  /** Fires once a GLB is actually applied, for analytics/debugging. */
  onModelLoaded?: (loaded: boolean) => void;
}

export function AvatarAsset(props: AvatarAssetProps) {
  // Destructure explicitly: spreading `props` into useGLTF widens the URL type
  // to `string | null | undefined`, which useGLTF will not accept — and
  // `onModelLoaded` is not a body prop, so it must not leak into Procedural.
  const {
    modelUrl,
    body,
    onModelLoaded,
    skinToneHex,
    hairStyleId,
    hairColorHex,
  } = props;
  const shared = { body, skinToneHex, hairStyleId, hairColorHex };
  const url = modelUrl ?? defaultAvatarModelUrl(body.gender);
  const metrics = useMemo(() => deriveMetrics(body), [body]);
  if (!url) return <Procedural {...shared} metrics={metrics} />;
  return (
    <AssetErrorBoundary fallback={<Procedural {...shared} metrics={metrics} />}>
      <Suspense fallback={<Procedural {...shared} metrics={metrics} />}>
        <LoadedGlbAvatar
          {...shared}
          metrics={metrics}
          modelUrl={url}
          onModelLoaded={onModelLoaded}
        />
      </Suspense>
    </AssetErrorBoundary>
  );
}

function Procedural(
  props: Omit<AvatarAssetProps, "modelUrl"> & { metrics: AvatarMetrics },
) {
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
class AssetErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A missing 3D asset is a content problem, not an application crash.
    console.warn(
      "[AvatarAsset] GLB failed to load, using procedural body:",
      error,
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** LoadedGlbAvatar is only ever rendered with a non-null URL. */
type LoadedProps = Omit<AvatarAssetProps, "modelUrl"> & {
  modelUrl: string;
  metrics: AvatarMetrics;
};

/**
 * Measured constants for a bundled base. An unregistered third-party URL
 * borrows the gender base's anchor and assumes metres — approximate by
 * necessity. Measure and register the model (avatar-models.ts) if it matters.
 */
function specFor(
  modelUrl: string,
  gender: BodyParams["gender"],
): AvatarModelSpec {
  return (
    (Object.values(AVATAR_MODELS) as AvatarModelSpec[]).find(
      (m) => m.url === modelUrl,
    ) ?? {
      ...avatarModelFor(gender),
      url: modelUrl,
      height: 1.7,
      offset: [0, 0, 0],
    }
  );
}

function cloneMaterials(root: THREE.Object3D) {
  // useGLTF caches by URL: mutating a shared material (tinting!) would leak
  // across avatars — compare mode with two skin tones would tint both. Clone
  // once per instance so colour writes are private.
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as Material | Material[];
    mesh.material = Array.isArray(mat)
      ? mat.map((m) => m.clone())
      : mat.clone();
  });
}

function materialsOf(root: THREE.Object3D): Material[] {
  const out: Material[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as Material | Material[];
    for (const entry of Array.isArray(mat) ? mat : [mat]) out.push(entry);
  });
  return out;
}

function findHeadBone(
  root: THREE.Object3D,
  spec: AvatarModelSpec,
): Bone | null {
  let found: Bone | null = null;
  root.traverse((o) => {
    if (found) return;
    const bone = o as Bone;
    if (bone.isBone && spec.headBone.test(bone.name)) found = bone;
  });
  return found;
}

function LoadedGlbAvatar({
  body,
  skinToneHex,
  hairStyleId,
  hairColorHex,
  modelUrl,
  onModelLoaded,
  metrics,
}: LoadedProps) {
  const { scene } = useGLTF(modelUrl) as { scene: THREE.Object3D };
  const spec = useMemo(
    () => specFor(modelUrl, body.gender),
    [modelUrl, body.gender],
  );
  const hairUrl = hairModelUrl(hairStyleId);
  const invalidate = useThree((s) => s.invalidate);

  // Clone so two avatars on screen (compare mode) never share transforms, and
  // so a re-render cannot mutate the cached scene that useGLTF holds.
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    cloneMaterials(c);
    return c;
  }, [scene]);
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

  // Skin tint: ONLY *skin* materials. Copying colour preserves roughness,
  // metalness and maps, so the lighting response is unchanged. The face
  // (eyes/mouth) and clothes keep their authored colours.
  useEffect(() => {
    const colour = new THREE.Color(skinToneHex);
    for (const entry of materialsOf(clone)) {
      if (!(entry.name ?? "").toLowerCase().includes("skin")) continue;
      if ("color" in entry)
        (entry as THREE.MeshStandardMaterial).color.copy(colour);
    }
    invalidate();
  }, [clone, skinToneHex, invalidate]);

  // The bundled bases ship a full fringe-and-sides hair mesh. A hairpiece must
  // HIDE it, because the two are independent shells that interpenetrate: with
  // both visible the cap's rim disappears inside the built-in hair and the
  // style reads as "nothing changed". The caps are cut down to the hairline
  // (scripts/generate-hair.mjs), so what shows is the hairpiece alone.
  useEffect(() => {
    clone.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as Material | Material[];
      const mats = Array.isArray(mat) ? mat : [mat];
      if (mats.some((m) => (m.name ?? "").toLowerCase().includes("hair"))) {
        mesh.visible = hairUrl === null;
      }
    });
    invalidate();
  }, [clone, hairUrl, invalidate]);

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
      // arms move together and the skeleton stays connected. Head/neck never
      // match a role, so facial proportions survive every slider.
      bone.scale.set(x, y, z);
    });
    root.current.updateMatrixWorld(true);
    invalidate();
  }, [scales, invalidate]);

  // Normalise the file's unit height onto the shopper's metric height, after
  // recentering feet to the origin. Nested so the offset applies in model
  // units BEFORE the height scale, never fighting it.
  const heightScale = metrics.height / spec.height;

  useEffect(() => {
    onModelLoaded?.(true);
  }, [onModelLoaded]);

  return (
    <group scale={[heightScale, heightScale, heightScale]}>
      <group ref={root} position={spec.offset}>
        <primitive object={clone} />
        {/*
          Keyed by the body URL, NOT the hair URL. Both avatars in compare mode
          mount the SAME hairpiece, so with the hair URL as the key React
          reuses the first <HairAttachment>'s element and `<primitive>` — and a
          primitive attaches its object BY REFERENCE, so the second avatar
          silently steals the first's hair object and both end up sharing one
          copy. Per-avatar keys force a distinct element and clone each time.
        */}
        {hairUrl && (
          <HairAttachment
            key={`${spec.url}:${hairUrl}`}
            styleUrl={hairUrl}
            hairColorHex={hairColorHex}
            spec={spec}
            heightScale={heightScale}
            scalesVersion={scales}
          />
        )}
      </group>
    </group>
  );
}

/**
 * Attaches a hairstyle GLB at the model's head anchor.
 *
 * The hair is authored around its own origin (= head centre, +Z to the face)
 * and lives as a sibling of the body inside the offset group — NOT parented
 * to the head bone, so it can never inherit a bad bind transform. Each pass
 * it is re-glued onto the head: matrix = headNow x inv(headRef) x anchor,
 * where headRef is the head matrix captured under a reference body. Body
 * sliders therefore drag the hair along rigidly with the skull, exactly like
 * a real hairpiece follows the head. The frame is invalidated so
 * `frameloop="demand"` canvases actually repaint.
 */
function HairAttachment({
  styleUrl,
  hairColorHex,
  spec,
  heightScale,
  scalesVersion,
}: {
  styleUrl: string;
  hairColorHex: string;
  spec: AvatarModelSpec;
  heightScale: number;
  scalesVersion: unknown;
}) {
  const { scene } = useGLTF(styleUrl) as { scene: THREE.Object3D };
  const invalidate = useThree((s) => s.invalidate);
  const portalHost = useRef<Group>(null);

  const hair = useMemo(() => {
    const c = scene.clone(true);
    cloneMaterials(c);
    return c;
  }, [scene]);

  useEffect(() => {
    const colour = new THREE.Color(hairColorHex);
    for (const entry of materialsOf(hair)) {
      if ("color" in entry)
        (entry as THREE.MeshStandardMaterial).color.copy(colour);
    }
    invalidate();
  }, [hair, hairColorHex, invalidate]);

  // Re-parent onto the head bone every frame.
  //
  // Three earlier approaches all looked correct and all failed the same way:
  // the object reached the GPU (onBeforeRender fired) while sitting at the
  // avatar's feet, occluded by the body. The cause is R3F reconciling the
  // element's props on every commit, which restores matrixAutoUpdate and
  // recomposes the matrix from position/quaternion/scale — so any transform
  // written from outside React is discarded on the next render.
  //
  // Reparenting dodges all of that: the hair becomes a real child of the head
  // bone, inherits its world matrix for free, follows every body slider
  // automatically, and React never touches it because the bone is not a React
  // element.
  useFrame(() => {
    const offsetGroup = portalHost.current?.parent;
    if (!offsetGroup) return;
    const head = findHeadBone(offsetGroup, spec);
    if (!head) return; // headless rig: keep the body, skip the hair

    head.updateWorldMatrix(true, false);
    offsetGroup.updateWorldMatrix(true, false);

    if (hair.parent !== head) {
      // attach() detaches from any previous parent first, so switching bases or
      // re-picking a style can never leave an orphan copy behind.
      head.attach(hair);
      // Where the hair's origin must sit, in world space. The offset group only
      // translates by spec.offset, so the anchor enters it unchanged.
      const anchorWorld = new THREE.Vector3(...spec.headAnchor).applyMatrix4(
        offsetGroup.matrixWorld,
      );
      // Solve hairLocal from head.matrixWorld * hairLocal = anchorWorld. Doing
      // this rather than hardcoding an offset is what lets the child base's
      // 1.25x head-joint scale resolve itself.
      const local = new THREE.Matrix4()
        .copy(head.matrixWorld)
        .invert()
        .multiply(
          new THREE.Matrix4().makeTranslation(anchorWorld.x, anchorWorld.y, anchorWorld.z),
        );
      hair.position.setFromMatrixPosition(local);
      hair.updateMatrixWorld(true);
    }

    const box = new THREE.Box3().setFromObject(hair);
    const headWorld = new THREE.Vector3();
    head.getWorldPosition(headWorld);
    console.log(
      `[HAIR] ${styleUrl} parent=${hair.parent?.type}/${(hair.parent as Bone).name} ` +
        `localPos=${hair.position.toArray().map((v) => v.toFixed(3)).join(",")} ` +
        `worldCentre=${box.getCenter(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join(",")} ` +
        `headJointWorld=${headWorld.toArray().map((v) => v.toFixed(3)).join(",")}`,
    );
    invalidate();
  });

  return (
    <group ref={portalHost}>
      <primitive object={hair} />
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

/** Warm every bundled base + hairpiece (call on fitting-room entry). */
export function preloadFittingRoomAssets() {
  try {
    for (const m of Object.values(AVATAR_MODELS)) useGLTF.preload(m.url);
    for (const style of ["bun", "long", "braid", "short", "turban"] as const) {
      const url = hairModelUrl(style);
      if (url) useGLTF.preload(url);
    }
  } catch {
    // Preload is an optimisation; a failure here must never break the page.
  }
}

export type { AvatarMetrics };
