/**
 * Multi-currency engine.
 *
 * The catalog is priced in USD (the base). Everything user-facing resolves a
 * local currency at read time. Rates are cached (Redis in prod, in-process TTL
 * in dev) so we never call the FX provider on a hot render path.
 *
 * Design rules:
 *  - Never store a converted price. Store USD + the rate you used.
 *  - Prices are rounded to "psychological" endings per currency (e.g. KRW
 *    rounds to 10s, JPY has no minor unit) so displayed totals look native.
 *  - If the live feed fails we degrade to the bundled fallback table and mark
 *    the response `stale: true` rather than 500-ing checkout.
 */

export type CurrencyCode =
  | 'USD' | 'EUR' | 'GBP' | 'KRW' | 'JPY' | 'INR' | 'AUD' | 'CAD'
  | 'SGD' | 'AED' | 'CHF' | 'CNY' | 'HKD' | 'NZD' | 'ZAR' | 'BRL'
  | 'MXN' | 'SEK' | 'NOK' | 'DKK' | 'PLN' | 'TRY';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  /** Minor-unit exponent. JPY/KRW = 0, USD/EUR = 2. */
  decimals: number;
  locale: string;
  /** Rounding granularity applied after conversion, in major units. */
  roundTo: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: 'USD', symbol: '$',   decimals: 2, locale: 'en-US',      roundTo: 0.01 },
  EUR: { code: 'EUR', symbol: '\u20ac', decimals: 2, locale: 'de-DE',    roundTo: 0.01 },
  GBP: { code: 'GBP', symbol: '\u00a3', decimals: 2, locale: 'en-GB',    roundTo: 0.01 },
  KRW: { code: 'KRW', symbol: '\u20a9', decimals: 0, locale: 'ko-KR',      roundTo: 100 },
  JPY: { code: 'JPY', symbol: '\u00a5', decimals: 0, locale: 'ja-JP',      roundTo: 100 },
  INR: { code: 'INR', symbol: '\u20b9', decimals: 2, locale: 'en-IN',      roundTo: 10 },
  AUD: { code: 'AUD', symbol: 'A$',  decimals: 2, locale: 'en-AU',      roundTo: 0.05 },
  CAD: { code: 'CAD', symbol: 'C$',  decimals: 2, locale: 'en-CA',      roundTo: 0.05 },
  SGD: { code: 'SGD', symbol: 'S$',  decimals: 2, locale: 'en-SG',      roundTo: 0.05 },
  AED: { code: 'AED', symbol: 'AED', decimals: 2, locale: 'ar-AE',      roundTo: 0.5 },
  CHF: { code: 'CHF', symbol: 'CHF', decimals: 2, locale: 'de-CH',      roundTo: 0.05 },
  CNY: { code: 'CNY', symbol: '\u00a5', decimals: 2, locale: 'zh-CN',      roundTo: 0.5 },
  HKD: { code: 'HKD', symbol: 'HK$', decimals: 2, locale: 'zh-HK',      roundTo: 0.5 },
  NZD: { code: 'NZD', symbol: 'NZ$', decimals: 2, locale: 'en-NZ',      roundTo: 0.05 },
  ZAR: { code: 'ZAR', symbol: 'R',   decimals: 2, locale: 'en-ZA',      roundTo: 0.05 },
  BRL: { code: 'BRL', symbol: 'R$',  decimals: 2, locale: 'pt-BR',      roundTo: 0.05 },
  MXN: { code: 'MXN', symbol: 'MX$', decimals: 2, locale: 'es-MX',      roundTo: 0.5 },
  SEK: { code: 'SEK', symbol: 'kr',  decimals: 2, locale: 'sv-SE',      roundTo: 1 },
  NOK: { code: 'NOK', symbol: 'kr',  decimals: 2, locale: 'nb-NO',      roundTo: 1 },
  DKK: { code: 'DKK', symbol: 'kr',  decimals: 2, locale: 'da-DK',      roundTo: 1 },
  PLN: { code: 'PLN', symbol: 'z\u0142', decimals: 2, locale: 'pl-PL',   roundTo: 0.5 },
  TRY: { code: 'TRY', symbol: '\u20ba', decimals: 2, locale: 'tr-TR',    roundTo: 0.5 },
};

/** ISO-3166 alpha-2 -> default currency. Covers the launch markets. */
export const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', ZA: 'ZAR',
  GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
  LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', CY: 'EUR', MT: 'EUR',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF', PL: 'PLN', TR: 'TRY',
  KR: 'KRW', JP: 'JPY', CN: 'CNY', HK: 'HKD', SG: 'SGD', IN: 'INR',
  AE: 'AED', AU: 'AUD', NZ: 'NZD',
};

/** Locale is chosen for language, not just currency. */
export const COUNTRY_LOCALE: Record<string, string> = {
  KR: 'ko', JP: 'ja', FR: 'fr', ES: 'es', DE: 'de', PT: 'pt', IT: 'it',
  NL: 'nl', SE: 'sv', NO: 'nb', DK: 'da', PL: 'pl', TR: 'tr', BR: 'pt-BR',
  MX: 'es-MX', CN: 'zh', IN: 'en-IN', GB: 'en-GB', US: 'en',
};

/**
 * Bundled fallback rates (units of local per 1 USD). Refreshed manually; only
 * used when the live feed is unreachable. Mid-market, no spread.
 */
export const FALLBACK_RATES: Record<CurrencyCode, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, KRW: 1380, JPY: 152, INR: 83.4,
  AUD: 1.52, CAD: 1.36, SGD: 1.34, AED: 3.6725, CHF: 0.88, CNY: 7.24,
  HKD: 7.81, NZD: 1.64, ZAR: 18.1, BRL: 5.05, MXN: 16.7, SEK: 10.5,
  NOK: 10.7, DKK: 6.87, PLN: 3.97, TRY: 32.2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(v: string | null | undefined): v is CurrencyCode {
  return !!v && v in CURRENCIES;
}

export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  if (!country) return 'USD';
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';
}

export function localeForCountry(country: string | null | undefined): string {
  if (!country) return 'en';
  return COUNTRY_LOCALE[country.toUpperCase()] ?? 'en';
}

export function localeTagForCurrency(code: CurrencyCode): string {
  return CURRENCIES[code].locale;
}
