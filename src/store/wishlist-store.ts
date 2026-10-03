'use client';

/**
 * Wishlist state, persisted to localStorage.
 *
 * Mirrors cart-store: the store holds state and calls into lib/wishlist for the
 * rules, so the logic stays testable without a React runtime.
 *
 * Persisted because a wishlist that vanishes on refresh is worse than no
 * wishlist at all — the shopper has just told us what they want, and losing it
 * teaches them not to bother.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isSaved, toggleEntry, removeEntry, type WishlistEntry } from '@/lib/wishlist';

interface WishlistState {
  entries: WishlistEntry[];
  /** @returns true if the item is now saved. */
  toggle: (entry: WishlistEntry) => boolean;
  remove: (slug: string) => void;
  clear: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      entries: [],

      toggle: (entry) => {
        const result = toggleEntry(get().entries, entry);
        set({ entries: result.entries });
        return result.saved;
      },

      remove: (slug) => set({ entries: removeEntry(get().entries, slug) }),

      clear: () => set({ entries: [] }),
    }),
    {
      name: 'vemporium-wishlist',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Read-only check for a component that only needs the boolean. */
export function wishlistHas(entries: WishlistEntry[], slug: string): boolean {
  return isSaved(entries, slug);
}

export const wishlistCount = (entries: WishlistEntry[]): number => entries.length;
