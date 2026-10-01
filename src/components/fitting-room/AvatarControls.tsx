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
import {
  cmToIn,
  formatLengthPrecise,
  inchToCm,
  kgToLb,
  lbToKg,
  stepFor,
  type UnitSystem,
} from '@/lib/units';
import { useMarketStore } from '@/store/market-store';

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
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Pre-formatted readout, so imperial mode can show 32.1 in while the value stays cm. */
  displayValue?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-xs text-stone-600">
        <span>{label}</span>
        <span className="font-mono text-[13px] font-semibold text-maroon">
          {displayValue ?? value}
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

/** Waist/hip slider that converts in both directions. */
function GirthSlider({
  unit,
  label,
  value,
  min,
  max,
  onChange,
}: {
  unit: UnitSystem;
  label: string;
  /** Always cm. */
  value: number;
  min: number;
  max: number;
  onChange: (cm: number) => void;
}) {
  if (unit === 'metric') {
    return <Slider label={label} value={value} min={min} max={max} step={0.5} onChange={onChange} />;
  }
  return (
    <Slider
      label={label}
      value={cmToIn(value)}
      min={cmToIn(min)}
      max={cmToIn(max)}
      step={0.2}
      unit="in"
      onChange={(inches) => onChange(inchToCm(inches))}
    />
  );
}

export function AvatarControls() {
  const body = useAvatarStore((s) => s.body);
  const skinToneHex = useAvatarStore((s) => s.skinToneHex);
  const hairStyleId = useAvatarStore((s) => s.hairStyleId);
  const hairColorHex = useAvatarStore((s) => s.hairColorHex);
  const autoRotate = useAvatarStore((s) => s.autoRotate);
  const compareMode = useAvatarStore((s) => s.compareMode);
  const unit = useMarketStore((s) => s.unit);
  const setUnit = useMarketStore((s) => s.setUnit);

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

      {/* Body parameters — the value stays metric internally; only the
          readout changes, so toggling units can never corrupt the avatar. */}
      <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="label-xs">Measurements</span>
          <div className="flex overflow-hidden rounded-full border border-stone-300">
            {(['metric', 'imperial'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={`px-2.5 py-0.5 text-[10px] font-medium ${
                  unit === u ? 'bg-maroon text-ivory' : 'bg-white text-stone-600'
                }`}
              >
                {u === 'metric' ? 'cm / kg' : 'in / lb'}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Height"
          value={body.heightCm}
          min={95}
          max={200}
          step={stepFor(unit, 200)}
          displayValue={formatLengthPrecise(body.heightCm, unit)}
          onChange={(v) => set({ heightCm: unit === 'imperial' ? inchToCm(v) : v })}
        />
        <Slider
          label="Weight"
          value={unit === 'imperial' ? kgToLb(body.weightKg) : body.weightKg}
          min={unit === 'imperial' ? 26 : 12}
          max={unit === 'imperial' ? 310 : 140}
          step={unit === 'imperial' ? 1 : 0.5}
          unit={unit === 'imperial' ? 'lb' : 'kg'}
          displayValue={unit === 'imperial' ? undefined : body.weightKg.toFixed(1)}
          onChange={(v) => set({ weightKg: unit === 'imperial' ? lbToKg(v) : v })}
        />
        {mens ? (
          <Slider
            label="Chest"
            value={unit === 'imperial' ? cmToIn(body.chestCm ?? 96) : body.chestCm ?? 96}
            min={unit === 'imperial' ? 22 : 55}
            max={unit === 'imperial' ? 57 : 145}
            step={stepFor(unit, 145)}
            unit={unit === 'imperial' ? 'in' : 'cm'}
            displayValue={unit === 'imperial' ? undefined : String(body.chestCm ?? 96)}
            onChange={(v) => set({ chestCm: unit === 'imperial' ? inchToCm(v) : v })}
          />
        ) : (
          <Slider
            label="Bust"
            value={unit === 'imperial' ? cmToIn(body.bustCm ?? 90) : body.bustCm ?? 90}
            min={unit === 'imperial' ? 22 : 55}
            max={unit === 'imperial' ? 57 : 145}
            step={stepFor(unit, 145)}
            unit={unit === 'imperial' ? 'in' : 'cm'}
            displayValue={unit === 'imperial' ? undefined : String(body.bustCm ?? 90)}
            onChange={(v) => set({ bustCm: unit === 'imperial' ? inchToCm(v) : v })}
          />
        )}
        <GirthSlider unit={unit} label="Waist" value={body.waistCm} min={45} max={140} onChange={(cm) => set({ waistCm: cm })} />
        <GirthSlider unit={unit} label="Hips" value={body.hipCm} min={55} max={150} onChange={(cm) => set({ hipCm: cm })} />
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
