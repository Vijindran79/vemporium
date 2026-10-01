'use client';

import Link from 'next/link';
import { cartCount, useCartStore } from '@/store/cart-store';

export function SiteHeader() {
  const lines = useCartStore((s) => s.lines);
  const count = cartCount(lines);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-ivory/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-display text-xl tracking-tight text-maroon">
          Vemporium
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/catalog" className="btn-ghost hidden sm:inline-block">
            Shop
          </Link>
          <Link href="/fitting-room" className="btn-ghost hidden sm:inline-block">
            Fitting room
          </Link>

          <Link
            href="/cart"
            className="relative rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-maroon/40"
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            Cart
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-maroon px-1 text-[10px] font-bold text-ivory">
                {count}
              </span>
            )}
          </Link>

          <Link href="/fitting-room" className="btn-primary">
            <span className="hidden sm:inline">Create your avatar</span>
            <span className="sm:hidden">Try on</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
