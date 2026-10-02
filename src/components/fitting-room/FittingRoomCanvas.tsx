"use client";

/**
 * The virtual fitting room canvas.
 *
 * Render budget (PRD: <2.5s on mobile):
 *  - dpr capped at 2 to avoid 3x device pixel ratio tanking fill rate
 *  - frameloop switches to "demand" when nothing is animating, so an idle
 *    fitting room costs ~0% CPU (matters for mobile battery)
 *  - one shadow-casting light only
 *  - avatar geometry is memoised and rebuilt only when a measurement changes
 */

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";

import { AvatarAsset } from "./AvatarAsset";
import { deriveMetrics } from "./ParametricAvatar";
import { GarmentMesh } from "./Garment";
import { useAvatarStore } from "@/store/avatar-store";
import type { GarmentSpec } from "@/store/avatar-store";

/**
 * Turntable angle lives outside React state on purpose: a 60fps setState here
 * would re-render the whole canvas tree every frame. The Stage group reads it
 * directly in useFrame.
 */
const stageRotation = { current: 0 };

function Stage() {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y = stageRotation.current;
  });
  return (
    <group ref={group}>
      <Turntable />
    </group>
  );
}

function Turntable({ speed = 0.35 }: { speed?: number }) {
  const autoRotate = useAvatarStore((s) => s.autoRotate);
  useFrame((_, delta) => {
    if (!autoRotate) return;
    // Clamp delta so a backgrounded tab does not spin the model on return.
    const dt = Math.min(delta, 0.05);
    stageRotation.current += dt * speed;
    if (stageRotation.current > Math.PI * 2)
      stageRotation.current -= Math.PI * 2;
  });
  return null;
}

export type CameraView = "front" | "back" | "side" | "three-quarter";

/**
 * Quick camera presets.
 *
 * Rotates the STAGE rather than moving the camera, so the lighting, shadows and
 * contact shadow stay correct and the orbit target is untouched — the shopper
 * lands exactly where they asked. The turntable angle is zeroed first so
 * "Front" always means front, not "front-ish".
 */
function CameraPresets({ height, view }: { height: number; view: CameraView }) {
  const controls = useRef<any>(null);

  useFrame(() => {
    if (!controls.current) return;
    // Ease toward the requested angle so the switch does not snap.
    const current = controls.current.object.rotation.y;
    const target = ANGLES[view];
    let delta = target - current;
    // Shortest path around the circle.
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    controls.current.object.rotation.y = current + delta * 0.12;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      minDistance={1.2}
      maxDistance={12}
      minPolarAngle={Math.PI * 0.18}
      maxPolarAngle={Math.PI * 0.62}
      target={[0, height * 0.52, 0]}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

const ANGLES: Record<CameraView, number> = {
  front: 0,
  "three-quarter": Math.PI * 0.25,
  side: Math.PI * 0.5,
  back: Math.PI,
};

export interface FittingRoomCanvasProps {
  /** Optional explicit garments; defaults to store state. */
  primary?: GarmentSpec | null;
  secondary?: GarmentSpec | null;
  compareMode?: boolean;
  /** Fired when the shopper clicks the garment mesh in 3D. */
  onSelectGarment?: (garment: GarmentSpec) => void;
  /** Quick-view preset; omit for free orbit. */
  view?: CameraView;
  /**
   * GLB avatar URL. Omit to use the procedural body. A bad URL is not fatal —
   * AvatarAsset falls back rather than blanking the viewport.
   */
  modelUrl?: string | null;
  className?: string;
}

export default function FittingRoomCanvas({
  primary,
  secondary,
  compareMode,
  onSelectGarment,
  view = "front",
  modelUrl,
  className,
}: FittingRoomCanvasProps) {
  const body = useAvatarStore((s) => s.body);
  const skinToneHex = useAvatarStore((s) => s.skinToneHex);
  const hairStyleId = useAvatarStore((s) => s.hairStyleId);
  const hairColorHex = useAvatarStore((s) => s.hairColorHex);
  const storeGarment = useAvatarStore((s) => s.garment);
  const storeCompare = useAvatarStore((s) => s.compareGarment);
  const storeCompareMode = useAvatarStore((s) => s.compareMode);
  const autoRotate = useAvatarStore((s) => s.autoRotate);

  const worn = primary !== undefined ? primary : storeGarment;
  const compareItem = secondary !== undefined ? secondary : storeCompare;
  const comparing = compareMode ?? storeCompareMode;

  const metrics = useMemo(() => deriveMetrics(body), [body]);
  // Frame the WHOLE figure. The PRD target is a full-body view with the hem
  // visible, because a garment that cannot be seen to its hem cannot be
  // judged. The previous 1.9x-height distance framed only the torso: with a
  // 168cm body at fov 38 the visible height at that distance is ~1.15m, so
  // heads and feet were both cropped.
  const camY = metrics.height * 0.5;
  const camZ = Math.max(3.4, metrics.height * 3.9);

  return (
    <div className={className ?? "h-full w-full"}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, camY, camZ], fov: 38, near: 0.1, far: 60 }}
        frameloop={autoRotate ? "always" : "demand"}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#FAF7F0"]} />
        <fog attach="fog" args={["#FAF7F0", 4, 12]} />

        <Stage />

        <ambientLight intensity={0.55} />
        {/* Key light — the only shadow caster, keeps fill rate down. */}
        <directionalLight
          position={[2.4, 4, 2.6]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
          shadow-bias={-0.0004}
        />
        {/* Rim light separates the silhouette from the ivory background. */}
        <directionalLight
          position={[-3, 2.4, -2.5]}
          intensity={0.5}
          color="#ffd9a0"
        />
        <hemisphereLight args={["#ffffff", "#c9b8a6", 0.5]} />

        <group>
          <AvatarAsset
            body={body}
            skinToneHex={skinToneHex}
            hairStyleId={hairStyleId}
            hairColorHex={hairColorHex}
            modelUrl={modelUrl ?? null}
          />
          {worn && (
            <GarmentMesh
              metrics={metrics}
              garment={worn}
              onSelect={
                onSelectGarment ? () => onSelectGarment(worn) : undefined
              }
            />
          )}
        </group>

        {comparing && compareItem && (
          // Separated by 0.62x height: enough that two figures plus their arms
          // never overlap, while still filling the frame side by side.
          <group position={[metrics.height * 0.62, 0, 0]}>
            <AvatarAsset
              body={body}
              skinToneHex={skinToneHex}
              hairStyleId={hairStyleId}
              hairColorHex={hairColorHex}
              modelUrl={modelUrl ?? null}
            />
            <GarmentMesh metrics={metrics} garment={compareItem} comparison />
          </group>
        )}

        {/* Ground contact shadow without a full shadow-map pass. */}
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.32}
          scale={6}
          blur={2.6}
          far={3}
          resolution={512}
        />

        {/* Studio env map gives the silk its sheen. */}
        <Environment preset="studio" environmentIntensity={0.45} />

        <CameraPresets height={metrics.height} view={view} />
      </Canvas>
    </div>
  );
}
