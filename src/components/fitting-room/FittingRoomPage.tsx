"use client";

/**
 * Fitting room shell.
 *
 * The Canvas is loaded with next/dynamic + ssr:false because three.js touches
 * `window` at import time. Everything else on this page is client state.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { AvatarControls } from "./AvatarControls";
import { GarmentPicker } from "./GarmentPicker";
import { preloadFittingRoomAssets } from "./AvatarAsset";
import { useAvatarStore } from "@/store/avatar-store";
import { CATALOG, toGarmentSpec, type CatalogItem } from "@/lib/catalog";
import type { CameraView, GarmentSpec } from "@/store/avatar-store";

const FittingRoomCanvas = dynamic(() => import("./FittingRoomCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-ivory">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-stone-300 border-t-maroon" />
        <p className="mt-3 text-xs text-stone-500">Loading the fitting room…</p>
      </div>
    </div>
  ),
});

export default function FittingRoomPage() {
  const wearGarment = useAvatarStore((s) => s.wearGarment);
  const setCompareGarment = useAvatarStore((s) => s.setCompareGarment);
  const compareMode = useAvatarStore((s) => s.compareMode);
  const [view, setView] = useState<CameraView>("front");

  const [ready, setReady] = useState(false);
  // Default the shopper into something wearing so the room is never empty.
  useEffect(() => {
    if (ready) return;
    preloadFittingRoomAssets();
    wearGarment(toGarmentSpec(CATALOG[0]));
    setCompareGarment(toGarmentSpec(CATALOG[2]));
    setReady(true);
  }, [ready, wearGarment, setCompareGarment]);

  const onWear = useCallback(
    (item: CatalogItem) => wearGarment(toGarmentSpec(item)),
    [wearGarment],
  );
  const onCompare = useCallback(
    (item: CatalogItem) => setCompareGarment(toGarmentSpec(item)),
    [setCompareGarment],
  );

  const handleGarmentClick = useCallback(
    (spec: GarmentSpec) => {
      // Clicking the mesh in the 3D view swaps it into the comparison slot, so
      // a shopper can hold two options up by clicking each in turn.
      setCompareGarment(spec);
    },
    [setCompareGarment],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-maroon sm:text-3xl">
            Virtual fitting room
          </h1>
          <p className="mt-0.5 text-sm text-stone-600">
            Set your measurements, pick a garment, and see exactly how it will
            fall on you.
          </p>
        </div>
        {compareMode && (
          <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-medium text-maroon">
            Comparing two looks side by side
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Controls */}
        <aside className="card order-2 max-h-[70vh] overflow-hidden lg:order-1 lg:max-h-[calc(100vh-190px)]">
          <AvatarControls />
        </aside>

        {/* Canvas */}
        <div className="order-1 lg:order-2">
          <div className="card relative h-[52vh] min-h-[380px] overflow-hidden lg:h-[calc(100vh-190px)]">
            <FittingRoomCanvas
              onSelectGarment={handleGarmentClick}
              view={view}
            />

            {/* Quick camera presets, per the studio spec. */}
            <div className="absolute left-3 top-3 flex flex-col gap-1">
              {(
                [
                  ["front", "Front"],
                  ["three-quarter", "3/4"],
                  ["side", "Side"],
                  ["back", "Back"],
                ] as [CameraView, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    view === v
                      ? "bg-maroon text-ivory"
                      : "bg-white/85 text-stone-600 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/85 px-3 py-1 text-[11px] text-stone-500 backdrop-blur">
              Drag to rotate · pinch or scroll to zoom
            </p>
          </div>
        </div>

        {/* Garment picker */}
        <div className="order-3 lg:col-span-2">
          <GarmentPicker onWear={onWear} onCompare={onCompare} />
        </div>
      </div>
    </div>
  );
}
