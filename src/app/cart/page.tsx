import type { Metadata } from 'next';
import { CartView } from '@/components/cart/CartView';

export const metadata: Metadata = {
  title: 'Your cart — Vemporium',
  robots: { index: false },
};

export default function CartPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 font-display text-3xl text-maroon">Your cart</h1>
      <CartView />
    </main>
  );
}
