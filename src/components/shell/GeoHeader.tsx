'use client';

/**
 * Geo-banner + market selector.
 *
 * Spec: "Shipping to 🇰🇷 South Korea | Prices shown in ₩ KRW" with a manual
 * currency/language override.
 *
 * One deliberate decision: the banner shows what we DETECTED, not a guess
 * dressed as certainty. If geolocation failed we say so and invite the shopper
 * to pick, because silently defaulting a Korean customer to USD and charging
 * them the wrong number is the worst first impression we can make.
 */

import { useEffect, useRef, useState } from 'react';
import {
  CURRENCIES,
  SUPPORTED_CURRENCIES,
  currencyForCountry,
  isCurrencyCode,
  localeForCountry,
  type CurrencyCode,
} from '@/lib/currency';
import { LANGUAGES, MARKET_COUNTRIES, useMarketStore } from '@/store/market-store';
import { useMoney } from '@/components/shell/MoneyProvider';

const POPULAR_CURRENCIES: CurrencyCode[] = ['KRW', 'JPY', 'USD', 'EUR', 'GBP', 'AUD', 'INR', 'CAD', 'SGD', 'AED'];

function useOutsideClick(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);
  return ref;
}

export function GeoHeader() {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick(() => setOpen(false));

  // Read the resolved market from the provider, not the raw store: the provider
  // already merges "manual override wins, else use the server-resolved value",
  // which is what makes this correct on the very first server render.
  const market = useMoney();
  const setMarket = useMarketStore((s) => s.setMarket);

  const country = market.country;
  const currency = market.currency;
  const locale = market.locale;
  const isGuess = market.isGuess;

  const meta = CURRENCIES[currency];
  const entry = MARKET_COUNTRIES.find((c) => c.code === country);

  function pickCountry(code: string) {
    setMarket({ country: code, currency: currencyForCountry(code), locale: localeForCountry(code) });
    setOpen(false);
  }
  function pickCurrency(code: CurrencyCode) {
    if (!isCurrencyCode(code)) return;
    setMarket({ country, currency: code, locale });
    setOpen(false);
  }
  function pickLanguage(code: string) {
    setMarket({ country, currency, locale: code });
    setOpen(false);
  }

  return (
    <div className="relative border-b border-stone-200 bg-maroon text-ivory">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-1.5 text-xs">
        <p className="flex min-w-0 items-center gap-1.5">
          {isGuess ? (
            <span className="truncate text-ivory/80">
              🌍 Shipping worldwide · set your country for local pricing
            </span>
          ) : (
            <span className="truncate">
              <span aria-hidden="true">{entry?.flag}</span> Shipping to{' '}
              <strong className="font-semibold">{entry?.name}</strong>
              <span className="mx-1.5 text-ivory/40">|</span>Prices in{' '}
              <strong className="font-semibold">
                {meta.symbol} {currency}
              </strong>
            </span>
          )}
        </p>

        <div className="relative shrink-0" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="rounded-full border border-ivory/30 px-2.5 py-1 font-medium transition-colors hover:bg-ivory/10"
          >
            {meta.symbol} {currency}
            <span className="ml-1 text-[9px] uppercase opacity-70">{locale}</span>
            <span className="ml-1 inline-block transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
              ▾
            </span>
          </button>

          {open && (
            <div
              role="dialog"
              aria-label="Choose your market"
              className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-stone-200 bg-white p-3 text-stone-700 shadow-xl"
            >
              <p className="label-xs">Ship to</p>
              <div className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto pr-1">
                {MARKET_COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => pickCountry(c.code)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-stone-100 ${
                      c.code === country ? 'font-semibold text-maroon' : ''
                    }`}
                  >
                    <span>
                      {c.flag} {c.name}
                    </span>
                    <span className="text-[10px] text-stone-400">{currencyForCountry(c.code)}</span>
                  </button>
                ))}
              </div>
              <p className="label-xs mt-3">Currency</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {POPULAR_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pickCurrency(c)}
                    aria-pressed={c === currency}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      c === currency ? 'border-maroon bg-maroon text-ivory' : 'border-stone-300 hover:border-maroon/40'
                    }`}
                  >
                    {c}
                  </button>
                ))}
                <details className="w-full">
                  <summary className="cursor-pointer text-[11px] text-stone-500 hover:text-maroon">
                    All {SUPPORTED_CURRENCIES.length} currencies
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => pickCurrency(c)}
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          c === currency ? 'border-maroon bg-maroon text-ivory' : 'border-stone-300'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </details>
              </div>

              <p className="label-xs mt-3">Language</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => pickLanguage(l.code)}
                    aria-pressed={l.code === locale}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      l.code === locale ? 'border-maroon bg-maroon text-ivory' : 'border-stone-300 hover:border-maroon/40'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
