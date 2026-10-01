import type { Metadata } from 'next';
import { VendorDashboard } from '@/components/vendor/VendorDashboard';

export const metadata: Metadata = {
  title: 'Restock dispatch — Vemporium',
  robots: { index: false },
};

/**
 * Operations view. In production this sits behind auth and is staff-only;
 * it is public here so the supply-chain engine can be demonstrated.
 */
export default function VendorPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <span className="label-xs text-saffron">Operations</span>
        <h1 className="mt-1 font-display text-3xl text-maroon">Supplier restock dispatch</h1>
        <p className="mt-1 text-sm text-stone-600">
          When a sale drops a SKU below its threshold, the engine raises a purchase order and messages the
          workshop automatically. This is the operator&rsquo;s view of that decision.
        </p>
      </header>
      <VendorDashboard />
    </main>
  );
}
