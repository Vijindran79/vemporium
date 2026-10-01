'use client';

/**
 * Market state — the country / currency / language the shopper sees.
 *
 * The server resolves a sensible default (edge GeoIP + cookie) and passes it in
 * as `initial`. After that the CLIENT owns it, because the spec has a manual
 * selector: if a traveller is in Japan but wants to browse in USD, their choice
 * must win over the IP, not race it.
 *
 * Persisted to localStorage so a returning shopper is not re-geolocated into a
 * currency they already rejected.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CurrencyCode } from '@/lib/currency';

export interface MarketState {
  country: string | null;
  currency: CurrencyCode;
  locale: string;
  /** True when we could not positively identify the visitor. */
  isGuess: boolean;
  /** True when the shopper chose manually — suppresses the geo banner nag. */
  manuallySet: boolean;
  unit: 'metric' | 'imperial';

  setMarket: (m: { country: string | null; currency: CurrencyCode; locale: string; isGuess?: boolean }) => void;
  setUnit: (u: 'metric' | 'imperial') => void;
  /** Hydrates from the server-resolved default, only if the user has no saved choice. */
  hydrate: (m: { country: string | null; currency: CurrencyCode; locale: string; isGuess: boolean }) => void;
}

export const useMarketStore = create<MarketState>()(
  persist(
    (set, get) => ({
      country: null,
      currency: 'USD',
      locale: 'en',
      isGuess: true,
      manuallySet: false,
      unit: 'metric',

      setMarket: (m) => set({ ...m, isGuess: m.isGuess ?? false, manuallySet: true }),

      setUnit: (unit) => set({ unit }),

      hydrate: (m) => {
        // A saved manual choice always wins over server geo detection.
        if (get().manuallySet) return;
        set({ ...m });
      },
    }),
    {
      name: 'vp_market',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// Reference data lives in a plain module so server components can import it.
export { MARKET_COUNTRIES, COUNTRY_NAMES, LANGUAGES } from '@/lib/markets';
