import type { Metadata } from 'next';
import { CatalogGrid } from '@/components/catalog/CatalogGrid';
import { CATALOG } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Shop Indian ethnic wear — Vemporium',
  description: 'Browse Sarees, Lehengas, Kurtas, Kurtis, Sherwanis and Dupattas from master weavers across India.',
};

// Prices re-price client-side when the shopper changes market, so this shell
// does not need to be dynamic on its own.
export default function CatalogPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-maroon">The collection</h1>
        <p className="mt-1 text-sm text-stone-600">
          Every piece is woven by a named workshop. Filter by garment, fabric or craft.
        </p>
      </header>
      <CatalogGrid items={CATALOG} />
    </main>
  );
}
