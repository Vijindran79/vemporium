'use client';

/**
 * Fitting-room control panel. Every control writes straight to the Zustand
 * store; the 3D scene subscribes to the slices it needs.
 */

import { useCallback } from 'react';
import {
  HAIR_COLORS,
  HAIRSTYLES,
  SKIN_TONES,
  useAvatarStore,
  useSizeRecommendation,
} from '@/store/avatar-store';
import { SIZE_ORDER, bmi, isMens, type Gender } from '@/lib/sizing';

const GENDERS: { id: Gender; label: string }[] = [
  { id: 'FEMALE', label: 'Women' },
  { id: 'MALE', label: 'Men' },
  { id: 'KID_GIRL', label: 'Girl' },
  { id: 'KID_BOY', label: 'Boy' },
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'cm',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs text-stone-600">
        <span>{label}</span>
        <span className="font-mono text-[13px] font-semibold text-maroon">
          {value}
          <span className="ml-0.5 text-[10px] font-normal text-stone-400">{unit}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-stone-200 accent-maroon"
        aria-label={label}
      />
    </label>
  );
}

function Swatches({
  options,
  active,
  onPick,
  label,
}: {
  options: readonly { id: string; label: string; hex: string }[];
  active: string;
  onPick: (id: string, hex: string) => void;
  label: string;
}) {
  return (
    <div>
      <span className="text-xs text-stone-600">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={active === o.hex}
            onClick={() => onPick(o.id, o.hex)}
            style={{ backgroundColor: o.hex }}
            className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
              active === o.hex ? 'border-maroon ring-2 ring-maroon/25' : 'border-white'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'border-maroon bg-maroon text-ivory' : 'border-stone-300 bg-white text-stone-700 hover:border-maroon/40'
      }`}
    >
      {children}
    </button>
  );
}

export function AvatarControls() {
  const body = useAvatarStore((s) => s.body);
  const skinToneHex = useAvatarStore((s) => s.skinToneHex);
  const hairStyleId = useAvatarStore((s) => s.hairStyleId);
  const hairColorHex = useAvatarStore((s) => s.hairColorHex);
  const autoRotate = useAvatarStore((s) => s.autoRotate);
  const compareMode = useAvatarStore((s) => s.compareMode);

  const setBody = useAvatarStore((s) => s.setBody);
  const setGender = useAvatarStore((s) => s.setGender);
  const setSkinTone = useAvatarStore((s) => s.setSkinTone);
  const setHairStyle = useAvatarStore((s) => s.setHairStyle);
  const setHairColor = useAvatarStore((s) => s.setHairColor);
  const applySizePreset = useAvatarStore((s) => s.applySizePreset);
  const toggleAutoRotate = useAvatarStore((s) => s.toggleAutoRotate);
  const toggleCompare = useAvatarStore((s) => s.toggleCompare);
  const reset = useAvatarStore((s) => s.reset);

  const rec = useSizeRecommendation();
  const mens = isMens(body.gender);
  const set = useCallback((patch: Parameters<typeof setBody>[0]) => setBody(patch), [setBody]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg text-maroon">Your avatar</h2>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-stone-500 underline-offset-2 hover:text-maroon hover:underline"
        >
          Reset
        </button>
      </header>

      {/* Age / gender mode */}
      <section>
        <span className="text-xs text-stone-600">Who are we fitting?</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {GENDERS.map((g) => (
            <Chip key={g.id} active={body.gender === g.id} onClick={() => setGender(g.id)}>
              {g.label}
            </Chip>
          ))}
        </div>
      </section>

      {/* One-tap size presets */}
      <section>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-stone-600">Start from a size</span>
          <span className="text-[11px] text-stone-400">BMI {bmi(body)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SIZE_ORDER.map((s) => (
            <Chip key={s} active={false} onClick={() => applySizePreset(s)}>
              {s}
            </Chip>
          ))}
          <Chip active={false} onClick={() => set({ bustCm: undefined, chestCm: undefined })}>
            Custom
          </Chip>
        </div>
      </section>

      {/* Body parameters */}
      <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
        <Slider label="Height" value={body.heightCm} min={95} max={200} onChange={(v) => set({ heightCm: v })} />
        <Slider label="Weight" value={body.weightKg} min={12} max={140} unit="kg" onChange={(v) => set({ weightKg: v })} />
        {mens ? (
          <Slider label="Chest" value={body.chestCm ?? 96} min={55} max={145} onChange={(v) => set({ chestCm: v })} />
        ) : (
          <Slider label="Bust" value={body.bustCm ?? 90} min={55} max={145} onChange={(v) => set({ bustCm: v })} />
        )}
        <Slider label="Waist" value={body.waistCm} min={45} max={140} onChange={(v) => set({ waistCm: v })} />
        <Slider label="Hips" value={body.hipCm} min={55} max={150} onChange={(v) => set({ hipCm: v })} />
      </section>

      {/* Appearance */}
      <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
        <Swatches options={SKIN_TONES} active={skinToneHex} onPick={(_id, hex) => setSkinTone(hex)} label="Skin tone" />
        <div>
          <span className="text-xs text-stone-600">Hairstyle</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {HAIRSTYLES.map((h) => (
              <Chip key={h.id} active={hairStyleId === h.id} onClick={() => setHairStyle(h.id)}>
                {h.label}
              </Chip>
            ))}
          </div>
        </div>
        <Swatches options={HAIR_COLORS} active={hairColorHex} onPick={(_id, hex) => setHairColor(hex)} label="Hair colour" />
      </section>

      {/* Size guidance */}
      <section className="rounded-lg border border-gold/40 bg-gold/5 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-stone-600">Recommended size</span>
          <span className="font-display text-xl font-semibold text-maroon">{rec.recommended}</span>
        </div>
        {rec.notes.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {rec.notes.map((n) => (
              <li key={n} className="text-[11px] leading-snug text-stone-600">• {n}</li>
            ))}
          </ul>
        )}
      </section>

      {/* View controls */}
      <section className="flex flex-wrap gap-1.5">
        <Chip active={autoRotate} onClick={toggleAutoRotate}>
          {autoRotate ? 'Pause 360°' : 'Auto-rotate'}
        </Chip>
        <Chip active={compareMode} onClick={toggleCompare}>
          Compare
        </Chip>
      </section>

      <p className="mt-auto pt-2 text-[10px] leading-relaxed text-stone-400">
        Drag to rotate · scroll to zoom. Your measurements stay on your account and are never shared with third
        parties.
      </p>
    </div>
  );
}
