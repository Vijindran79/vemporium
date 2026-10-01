'use client';

/**
 * Category-filtered garment rail for the fitting room.
 * "Wear" replaces the outfit on the avatar; "Compare" pins it to the second
 * slot so the two can be viewed together.
 */

import { useMemo, useState } from 'react';
import { CATEGORIES, filterCatalog, type CatalogItem, type CategoryFilter } from '@/lib/catalog';
import { useAvatarStore } from '@/store/avatar-store';

export function GarmentPicker({
  onWear,
  onCompare,
}: {
  onWear: (item: CatalogItem) => void;
  onCompare: (item: CatalogItem) => void;
}) {
  const [filter, setFilter] = useState<CategoryFilter>('All');
  const compareGarment = useAvatarStore((s) => s.compareGarment);
  const items = useMemo(() => filterCatalog(filter), [filter]);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['All', ...CATEGORIES] as CategoryFilter[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            aria-pressed={filter === c}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === c
                ? 'border-maroon bg-maroon text-ivory'
                : 'border-stone-300 bg-white text-stone-700 hover:border-maroon/40'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {items.map((item) => {
          const pinned = compareGarment?.id === item.id;
          return (
            <article key={item.id} className="flex flex-col overflow-hidden rounded-lg border border-stone-200">
              {/* Colour swatch stands in for the product image until the CDN
                  asset pipeline is wired up. */}
              <div
                className="relative h-24"
                style={{ backgroundColor: item.colourHex }}
                aria-hidden="true"
              >
                {item.accentHex && (
                  <div
                    className="absolute inset-x-0 bottom-0 h-2"
                    style={{ backgroundColor: item.accentHex }}
                  />
                )}
                {pinned && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-maroon">
                    Comparing
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <span className="label-xs">{item.categoryLabel}</span>
                <h3 className="text-[13px] font-medium leading-tight text-stone-800">{item.title}</h3>
                <p className="text-[11px] leading-snug text-stone-500">
                  {item.fabricLabel} · {item.workTypeLabel}
                </p>
                <p className="text-[11px] text-stone-400">Woven in {item.originCity}</p>

                <div className="mt-auto flex gap-1.5 pt-2">
                  <button type="button" onClick={() => onWear(item)} className="btn-primary flex-1 !px-3 !py-1.5 !text-[11px]">
                    Wear
                  </button>
                  <button
                    type="button"
                    onClick={() => onCompare(item)}
                    aria-pressed={pinned}
                    className="btn-ghost !px-3 !py-1.5 !text-[11px]"
                  >
                    Compare
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
