/**
 * GET /api/geo
 *
 * Resolves the visitor's market and returns a client-ready snapshot:
 *   - country, currency, locale
 *   - the full rate table (so the client can re-price the cart without a
 *     round trip on every interaction)
 *   - a cookie is set so subsequent requests skip geo detection entirely
 *
 * Query params:
 *   ?country=JP   force a market (used by the country switcher)
 *   ?amount=120   optional USD amount to convert, returns a formatted string
 *
 * Cache-Control is private: the response is personalised.
 */

import { NextResponse } from 'next/server';
import { resolveGeo, GEO_COOKIE, GEO_TTL_SECONDS } from '@/lib/geo';
import { getRateSnapshot, getRate, convert, formatMoney } from '@/lib/fx';
import { CURRENCIES, isCurrencyCode, SUPPORTED_CURRENCIES } from '@/lib/currency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const override = url.searchParams.get('country');
  const amountParam = url.searchParams.get('amount');

  const geo = await resolveGeo(override);

  // Persist the resolved country so the next request is a cookie hit.
  const headers = new Headers();
  if (geo.country) {
    headers.append(
      'set-cookie',
      `${GEO_COOKIE}=${geo.country}; Path=/; Max-Age=${GEO_TTL_SECONDS}; SameSite=Lax`,
    );
  }

  const { rates, asOf, stale } = await getRateSnapshot();

  const payload: Record<string, unknown> = {
    country: geo.country,
    currency: geo.currency,
    locale: geo.locale,
    source: geo.source,
    isGuess: geo.isGuess,
    rates,
    ratesAsOf: new Date(asOf).toISOString(),
    // Surfaced in the UI when we are on the bundled fallback table.
    ratesStale: stale,
    supported: SUPPORTED_CURRENCIES,
  };

  if (amountParam != null) {
    const amountUsd = Number(amountParam);
    if (Number.isFinite(amountUsd) && amountUsd >= 0) {
      const code = isCurrencyCode(url.searchParams.get('currency')) ? (url.searchParams.get('currency') as never) : geo.currency;
      const rate = await getRate(code);
      const converted = convert(amountUsd, rate, code);
      payload.converted = {
        amountUsd,
        amountLocal: converted,
        rate,
        currency: code,
        formatted: formatMoney(converted, code),
        decimals: CURRENCIES[code].decimals,
      };
    }
  }

  return NextResponse.json(payload, { headers });
}
