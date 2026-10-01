'use client';

/**
 * Catalog grid with search + facet filters.
 *
 * Search covers type, colour and fabric in one field, per the studio spec.
 * Filtering is client-side because the sample catalog is bundled; swap for a
 * server query once the catalog moves to Postgres.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCartStore } from '@/store/cart-store';
import { CATEGORIES, type CatalogItem, type CategoryFilter } from '@/lib/catalog';
import { useMoney } from '@/components/shell/MoneyProvider';

type GenderFilter = 'all' | 'women' | 'men' | 'kids';

const GENDER_FACET: { id: GenderFilter; label: string; match: (i: CatalogItem) => boolean }[] = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'women', label: 'Women', match: (i) => i.category !== 'SHERWANI' },
  { id: 'men', label: 'Men', match: (i) => i.category === 'SHERWANI' },
  { id: 'kids', label: 'Kids', match: (i) => i.category === 'KURTA' || i.category === 'KURTI' },
];

export function CatalogGrid({ items }: { items: CatalogItem[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [gender, setGender] = useState<GenderFilter>('all');
  const add = useCartStore((s) => s.add);
  const { money } = useMoney();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const facet = GENDER_FACET.find((f) => f.id === gender)!;
    return items.filter((item) => {
      if (category !== 'All' && item.categoryLabel !== category) return false;
      if (!facet.match(item)) return false;
      if (!q) return true;
      // One field searches name, fabric, craft, origin and hex.
      return [item.title, item.fabricLabel, item.workTypeLabel, item.categoryLabel, item.originCity, item.colourHex]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, query, category, gender]);

  return (
    <div>
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="sr-only">Search the collection</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by garment, fabric or craft — e.g. chanderi, zari, silk"
            className="w-full rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-maroon"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['All', ...CATEGORIES] as CategoryFilter[]).map((c) => (
            <FacetChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </FacetChip>
          ))}
          <span className="mx-1 h-4 w-px bg-stone-300" />
          {GENDER_FACET.map((f) => (
            <FacetChip key={f.id} active={gender === f.id} onClick={() => setGender(f.id)}>
              {f.label}
            </FacetChip>
          ))}
        </div>

        <p className="text-xs text-stone-500" aria-live="polite">
          {results.length} {results.length === 1 ? 'piece' : 'pieces'}
          {query && ` matching “${query}”`}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="font-display text-lg text-maroon">Nothing matches that yet</p>
          <p className="mt-1 text-sm text-stone-500">Try a broader search, or browse the full collection.</p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((item) => (
            <CatalogCard key={item.id} item={item} money={money} onQuickAdd={() => add(cartLineFrom(item), 1)} />
          ))}
        </div>
      )}
    </div>
  );
}

function cartLineFrom(item: CatalogItem) {
  return {
    slug: item.slug,
    title: item.title,
    size: 'M',
    priceUsd: item.priceUsd,
    colourHex: item.colourHex,
    accentHex: item.accentHex,
    categoryLabel: item.categoryLabel,
    fabricLabel: item.fabricLabel,
    originCity: item.originCity,
  };
}

function CatalogCard({
  item,
  money,
  onQuickAdd,
}: {
  item: CatalogItem;
  money: (usd: number) => string;
  onQuickAdd: () => void;
}) {
  return (
    <article className="card flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link href={`/product/${item.slug}`} className="block">
        <div className="relative h-44" style={{ backgroundColor: item.colourHex }}>
          {item.accentHex && <div className="absolute inset-x-0 bottom-0 h-2.5" style={{ backgroundColor: item.accentHex }} />}
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-maroon">
            {item.originCity}
          </span>
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-3">
        <span className="label-xs">{item.categoryLabel}</span>
        <h3 className="mt-0.5 text-sm font-medium leading-tight text-stone-800">
          <Link href={`/product/${item.slug}`} className="hover:text-maroon">
            {item.title}
          </Link>
        </h3>
        <p className="mt-1 text-[11px] text-stone-500">
          {item.fabricLabel} · {item.workTypeLabel}
        </p>

        <p className="mt-2 text-sm font-semibold text-maroon">{money(item.priceUsd)}</p>

        <div className="mt-auto flex gap-1.5 pt-3">
          <Link href={`/product/${item.slug}`} className="btn-ghost flex-1 !px-3 !py-1.5 !text-[11px]">
            Details
          </Link>
          <button type="button" onClick={onQuickAdd} className="btn-primary flex-1 !px-3 !py-1.5 !text-[11px]">
            Quick add
          </button>
        </div>
      </div>
    </article>
  );
}

function FacetChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
