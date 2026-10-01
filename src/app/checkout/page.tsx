import type { Metadata } from 'next';
import { CheckoutView } from '@/components/checkout/CheckoutView';

export const metadata: Metadata = {
  title: 'Checkout — Vemporium',
  robots: { index: false },
};

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-display text-3xl text-maroon">Checkout</h1>
      <CheckoutView />
    </main>
  );
}
