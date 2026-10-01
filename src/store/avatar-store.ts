'use client';

/**
 * Avatar + fitting-room state.
 *
 * Zustand over Context because the sliders in the side panel write at 60fps
 * while the R3F scene reads every frame — a context re-render of the whole
 * panel tree per slider tick is exactly the jank we are trying to avoid.
 */

import { create } from 'zustand';
import {
  defaultBody,
  isKid,
  isMens,
  recommendSize,
  type BodyParams,
  type Gender,
  type SizeRecommendation,
} from '@/lib/sizing';

/** Nine shade presets spanning the Fitzpatrick range. */
export const SKIN_TONES = [
  { id: 'porcelain', label: 'Porcelain', hex: '#F7DFCE' },
  { id: 'fair', label: 'Fair', hex: '#F0CDB2' },
  { id: 'light', label: 'Light', hex: '#E8B896' },
  { id: 'medium-light', label: 'Medium light', hex: '#D19A6E' },
  { id: 'medium', label: 'Medium', hex: '#B87D52' },
  { id: 'tan', label: 'Tan', hex: '#A2653C' },
  { id: 'deep', label: 'Deep', hex: '#8D5524' },
  { id: 'rich-deep', label: 'Rich deep', hex: '#6F4225' },
  { id: 'deepest', label: 'Deepest', hex: '#4E2E1A' },
] as const;

export const HAIRSTYLES = [
  { id: 'none', label: 'None' },
  { id: 'bun', label: 'Bun' },
  { id: 'long', label: 'Long' },
  { id: 'braid', label: 'Braid' },
  { id: 'short', label: 'Short' },
  { id: 'turban', label: 'Turban' },
] as const;

export const HAIR_COLORS = [
  { id: 'black', label: 'Black', hex: '#151012' },
  { id: 'dark-brown', label: 'Dark brown', hex: '#3A2419' },
  { id: 'brown', label: 'Brown', hex: '#6B4423' },
  { id: 'auburn', label: 'Auburn', hex: '#8C3B1B' },
  { id: 'grey', label: 'Grey', hex: '#9A918C' },
] as const;

export type DrapingType = 'WRAPPED' | 'RIGID' | 'FLOWING';

/** Quick camera presets. Declared here, not in the canvas, so the (ssr:false)
 *  canvas module is never type-imported by a page that renders on the server. */
export type CameraView = 'front' | 'back' | 'side' | 'three-quarter';

export interface GarmentSpec {
  id: string;
  title: string;
  category: string;
  drapingType: DrapingType;
  colourHex: string;
  /** 0..1 — how much the silhouette flares away from the body. */
  flare: number;
  /** Hem length in cm below the waist. */
  lengthCm: number;
  accentHex?: string;
  fabric: string;
}

interface AvatarState {
  body: BodyParams;
  skinToneHex: string;
  hairStyleId: string;
  hairColorHex: string;

  garment: GarmentSpec | null;
  compareGarment: GarmentSpec | null;
  compareMode: boolean;

  autoRotate: boolean;
  showDrapeGuide: boolean;

  // --- actions ---
  setBody: (patch: Partial<BodyParams>) => void;
  setGender: (gender: Gender) => void;
  setSkinTone: (hex: string) => void;
  setHairStyle: (id: string) => void;
  setHairColor: (hex: string) => void;
  applySizePreset: (preset: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL') => void;
  wearGarment: (g: GarmentSpec) => void;
  setCompareGarment: (g: GarmentSpec | null) => void;
  toggleCompare: () => void;
  toggleAutoRotate: () => void;
  toggleDrapeGuide: () => void;
  reset: () => void;
}

/**
 * Preset body values per size label, for the one-tap size buttons.
 *
 * These are calibrated to the garment blocks in src/lib/sizing.ts. If you
 * change a block, change the matching preset too — otherwise tapping a size
 * button recommends a different size, which is the fastest way to lose trust
 * in the fitting room. The regression test at the bottom of this file's
 * sibling suite asserts presets round-trip to the label they are named after.
 */
const PRESETS: Record<string, Partial<BodyParams>> = {
  XS: { heightCm: 158, weightKg: 50, waistCm: 61, hipCm: 87, bustCm: 81, chestCm: 85 },
  S:  { heightCm: 163, weightKg: 56, waistCm: 65, hipCm: 91, bustCm: 85, chestCm: 90 },
  M:  { heightCm: 170, weightKg: 64, waistCm: 70, hipCm: 97, bustCm: 90, chestCm: 95 },
  L:  { heightCm: 176, weightKg: 73, waistCm: 76, hipCm: 104, bustCm: 96, chestCm: 102 },
  XL: { heightCm: 181, weightKg: 84, waistCm: 82, hipCm: 111, bustCm: 102, chestCm: 109 },
  XXL:{ heightCm: 185, weightKg: 98, waistCm: 89, hipCm: 119, bustCm: 109, chestCm: 117 },
};

const KID_PRESETS: Record<string, Partial<BodyParams>> = {
  XS: { heightCm: 105, weightKg: 17, waistCm: 51, hipCm: 57, bustCm: 53, chestCm: 55 },
  S:  { heightCm: 119, weightKg: 22, waistCm: 54, hipCm: 61, bustCm: 57, chestCm: 59 },
  M:  { heightCm: 134, weightKg: 28, waistCm: 57, hipCm: 66, bustCm: 61, chestCm: 63 },
  L:  { heightCm: 149, weightKg: 35, waistCm: 61, hipCm: 71, bustCm: 66, chestCm: 68 },
  XL: { heightCm: 163, weightKg: 45, waistCm: 65, hipCm: 77, bustCm: 71, chestCm: 73 },
  XXL:{ heightCm: 176, weightKg: 57, waistCm: 70, hipCm: 83, bustCm: 77, chestCm: 79 },
};

const initialBody = defaultBody('FEMALE');

export const useAvatarStore = create<AvatarState>((set) => ({
  body: initialBody,
  skinToneHex: '#B87D52',
  hairStyleId: 'bun',
  hairColorHex: '#3A2419',
  garment: null,
  compareGarment: null,
  compareMode: false,
  autoRotate: true,
  showDrapeGuide: false,

  setBody: (patch) => set((s) => ({ body: { ...s.body, ...patch } })),

  setGender: (gender) =>
    set((s) => {
      const next = { ...defaultBody(gender) };
      // Preserve height/weight where they still make sense for the new age group.
      const wasKid = isKid(s.body.gender);
      const nowKid = isKid(gender);
      if (wasKid === nowKid) {
        next.heightCm = s.body.heightCm;
        next.weightKg = s.body.weightKg;
        next.waistCm = s.body.waistCm;
        next.hipCm = s.body.hipCm;
        if (isMens(gender)) next.chestCm = s.body.chestCm ?? s.body.bustCm;
        else next.bustCm = s.body.bustCm ?? s.body.chestCm;
      }
      return { body: next };
    }),

  setSkinTone: (hex) => set({ skinToneHex: hex }),
  setHairStyle: (id) => set({ hairStyleId: id }),
  setHairColor: (hex) => set({ hairColorHex: hex }),

  applySizePreset: (preset) =>
    set((s) => {
      const table = isKid(s.body.gender) ? KID_PRESETS : PRESETS;
      return { body: { ...s.body, ...(table[preset] ?? {}) } };
    }),

  wearGarment: (g) =>
    set((s) => ({ garment: g, compareGarment: s.compareGarment ?? g, compareMode: false })),
  setCompareGarment: (g) => set({ compareGarment: g, compareMode: !!g }),
  toggleCompare: () =>
    set((s) => ({
      // Comparing needs both slots filled.
      compareMode: s.garment && s.compareGarment ? !s.compareMode : false,
    })),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  toggleDrapeGuide: () => set((s) => ({ showDrapeGuide: !s.showDrapeGuide })),

  reset: () =>
    set({ body: initialBody, skinToneHex: '#B87D52', hairStyleId: 'bun', hairColorHex: '#3A2419' }),
}));

/** Derived selector — recomputes the recommended size from current params. */
export function useSizeRecommendation(): SizeRecommendation {
  const body = useAvatarStore((s) => s.body);
  return recommendSize(body);
}
