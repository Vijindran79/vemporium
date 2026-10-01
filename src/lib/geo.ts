/**
 * Geolocation resolution.
 *
 * Order of trust (cheapest + most accurate first):
 *   1. CDN/edge headers  — Vercel and CloudFront set these, and they cost zero
 *      extra network hops. On Vercel this is exact.
 *   2. Explicit override — the user picked a country in the UI / persisted it.
 *      Always wins, otherwise a VPN would silently change their currency.
 *   3. ipinfo lookup     — only when there are no edge headers (self-hosted).
 *
 * The result is cached for 24h keyed by IP, and mirrored in a cookie so repeat
 * visitors skip the lookup entirely.
 */

import { headers, cookies } from 'next/headers';
import { currencyForCountry, localeForCountry, type CurrencyCode } from './currency';

export interface GeoResult {
  country: string | null; // ISO-3166-1 alpha-2
  currency: CurrencyCode;
  locale: string;
  source: 'override' | 'cookie' | 'edge-header' | 'ipinfo' | 'default';
  /** True when we could not positively identify the visitor. */
  isGuess: boolean;
}

const GEO_COOKIE = 'vp_country';
const GEO_TTL_SECONDS = 60 * 60 * 24;

const EDGE_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-geo-country',
  'fly-client-ip-country',
  'x-country-code',
] as const;

function normaliseCountry(v: string | null | undefined): string | null {
  if (!v) return null;
  const code = v.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (code === 'XX' || code === 'T1') return null; // Tor / unknown markers
  return code;
}

async function ipInfoCountry(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const token = process.env.IPINFO_TOKEN;
  // ipinfo's free tier works without a token but is heavily rate limited.
  const url = token
    ? `https://ipinfo.io/${ip}/country?token=${token}`
    : `https://ipinfo.io/${ip}/country`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return normaliseCountry((await res.json())?.country);
  } catch {
    return null;
  }
}

/**
 * Resolves the visitor's market. Server-side only (uses next/headers).
 *
 * @param overrideCountry country explicitly chosen by the user, if any.
 */
export async function resolveGeo(overrideCountry?: string | null): Promise<GeoResult> {
  const explicit = normaliseCountry(overrideCountry);
  if (explicit) {
    return {
      country: explicit,
      currency: currencyForCountry(explicit),
      locale: localeForCountry(explicit),
      source: 'override',
      isGuess: false,
    };
  }

  const jar = await cookies();
  const fromCookie = normaliseCountry(jar.get(GEO_COOKIE)?.value);
  if (fromCookie) {
    return {
      country: fromCookie,
      currency: currencyForCountry(fromCookie),
      locale: localeForCountry(fromCookie),
      source: 'cookie',
      isGuess: false,
    };
  }

  const h = await headers();
  for (const name of EDGE_HEADERS) {
    const country = normaliseCountry(h.get(name));
    if (country) {
      return {
        country,
        currency: currencyForCountry(country),
        locale: localeForCountry(country),
        source: 'edge-header',
        isGuess: false,
      };
    }
  }

  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
  const viaLookup = await ipInfoCountry(ip);
  if (viaLookup) {
    return {
      country: viaLookup,
      currency: currencyForCountry(viaLookup),
      locale: localeForCountry(viaLookup),
      source: 'ipinfo',
      isGuess: false,
    };
  }

  // Last resort. We do NOT guess — defaulting to a plausible-but-wrong country
  // would show a customer in the wrong currency, which is worse than showing USD.
  return {
    country: null,
    currency: 'USD',
    locale: 'en',
    source: 'default',
    isGuess: true,
  };
}

export { GEO_COOKIE, GEO_TTL_SECONDS };
