'use client';

/**
 * Cart state.
 *
 * Line items are keyed by slug+size, and store the USD base price plus the FX
 * rate used at add-time. The rate is captured, not looked up later, so a cart
 * left open overnight does not silently change the customer's agreed total.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CartLine {
  slug: string;
  title: string;
  size: string;
  quantity: number;
  /** Base price at add time, USD. */
  priceUsd: number;
  colourHex: string;
  accentHex?: string;
  categoryLabel: string;
  fabricLabel: string;
  originCity: string;
}

interface CartState {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  remove: (slug: string, size: string) => void;
  setQuantity: (slug: string, size: string, quantity: number) => void;
  clear: () => void;
}

const keyOf = (slug: string, size: string) => `${slug}::${size}`;

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],

      add: (line, quantity = 1) =>
        set((s) => {
          const k = keyOf(line.slug, line.size);
          const existing = s.lines.find((l) => keyOf(l.slug, l.size) === k);
          if (existing) {
            return {
              lines: s.lines.map((l) =>
                keyOf(l.slug, l.size) === k ? { ...l, quantity: Math.min(10, l.quantity + quantity) } : l,
              ),
            };
          }
          return { lines: [...s.lines, { ...line, quantity: Math.min(10, quantity) }] };
        }),

      remove: (slug, size) =>
        set((s) => ({ lines: s.lines.filter((l) => keyOf(l.slug, l.size) !== keyOf(slug, size)) })),

      setQuantity: (slug, size, quantity) =>
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => keyOf(l.slug, l.size) !== keyOf(slug, size))
              : s.lines.map((l) =>
                  keyOf(l.slug, l.size) === keyOf(slug, size) ? { ...l, quantity: Math.min(10, quantity) } : l,
                ),
        })),

      clear: () => set({ lines: [] }),
    }),
    {
      name: 'vp_cart',
      storage: createJSONStorage(() => localStorage),
      // Quantity is a number and price is a number; no Dates or Sets to revive.
    },
  ),
);

/** Subtotal in USD — the single source of truth before localisation. */
export function cartSubtotalUsd(lines: CartLine[]): number {
  return Math.round(lines.reduce((a, l) => a + l.priceUsd * l.quantity, 0) * 100) / 100;
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + l.quantity, 0);
}
