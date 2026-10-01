'use client';

/**
 * Client-side money formatting.
 *
 * The server already renders the correct local price (no flash of the wrong
 * currency), but once the shopper uses the manual selector the price must
 * re-render in the new currency WITHOUT a page reload. This provider holds
 * the rate table for the active market and exposes a `money()` formatter.
 *
 * Rates are fetched from /api/geo, which applies the same server-side cache as
 * the SSR path, so this is not a second source of truth — it is the same table.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CURRENCIES, currencyForCountry, isCurrencyCode, localeForCountry, type CurrencyCode } from '@/lib/currency';
import { convert, formatMoney } from '@/lib/fx';
import { FALLBACK_RATES } from '@/lib/currency';
import { useMarketStore } from '@/store/market-store';

interface MoneyApi {
  /** Formats a USD base amount in the active local currency. */
  money: (amountUsd: number) => string;
  /** Raw converted number, for arithmetic in the cart. */
  convert: (amountUsd: number) => number;
  currency: CurrencyCode;
  /** Active destination country (ISO-2) after manual override. */
  country: string | null;
  locale: string;
  /** True when we could not positively identify the visitor. */
  isGuess: boolean;
  rate: number;
  /** True while the live rate table is loading. */
  loading: boolean;
  /** True when serving the bundled fallback rates. */
  stale: boolean;
}

const MoneyContext = createContext<MoneyApi | null>(null);

/** Synchronous first paint uses the bundled table, then the live one lands. */
const initialRates: Partial<Record<CurrencyCode, number>> = FALLBACK_RATES;

export function MoneyProvider({
  children,
  initialCountry,
  initialCurrency,
  initialLocale,
  initialIsGuess,
}: {
  children: React.ReactNode;
  initialCountry: string | null;
  initialCurrency: CurrencyCode;
  initialLocale: string;
  initialIsGuess: boolean;
}) {
  /**
   * Market resolution order:
   *   1. a manual choice the shopper made (persisted)
   *   2. the server-resolved market passed in as props
   *
   * Deliberately NOT reading the store's default for the fallback. Zustand's
   * persisted default is { currency: 'USD', isGuess: true }, and relying on it
   * meant the first server render showed "Shipping worldwide / USD" to a Korean
   * visitor until hydration corrected it. Deriving from props makes the first
   * paint correct by construction, on both the server and the client.
   */
  const store = useMarketStore();
  const manuallySet = store.manuallySet;
  const country = manuallySet ? store.country : initialCountry;
  const currency = manuallySet ? store.currency : initialCurrency;
  const locale = manuallySet ? store.locale : initialLocale;
  const isGuess = manuallySet ? store.isGuess : initialIsGuess;

  const [rates, setRates] = useState<Partial<Record<CurrencyCode, number>>>(initialRates);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);

  // Refresh the rate table whenever the active country changes.
  useEffect(() => {
    const target = country ?? 'US';
    let cancelled = false;
    setLoading(true);

    fetch(`/api/geo?country=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((data: { rates?: Partial<Record<CurrencyCode, number>>; ratesStale?: boolean }) => {
        if (cancelled || !data.rates) return;
        setRates(data.rates);
        setStale(!!data.ratesStale);
      })
      .catch(() => {
        /* keep the bundled table; money() still renders a sensible price */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [country]);

  const rate = rates[currency] ?? FALLBACK_RATES[currency] ?? 1;

  const money = useCallback(
    (amountUsd: number) => formatMoney(convert(amountUsd, rate, currency), currency, locale),
    [rate, currency, locale],
  );

  const value = useMemo<MoneyApi>(
    () => ({
      money,
      convert: (amountUsd: number) => convert(amountUsd, rate, currency),
      currency,
      country,
      locale,
      isGuess,
      rate,
      loading,
      stale,
    }),
    [money, rate, currency, country, locale, isGuess, loading, stale],
  );

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoney(): MoneyApi {
  const ctx = useContext(MoneyContext);
  if (!ctx) throw new Error('useMoney must be used inside <MoneyProvider>');
  return ctx;
}

export { currencyForCountry, localeForCountry, isCurrencyCode };
