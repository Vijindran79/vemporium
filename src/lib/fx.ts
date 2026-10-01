/**
 * FX rate fetching + caching + formatting.
 *
 * Cache strategy: rates move intraday, never per-second, so a 1-hour TTL is
 * safe and keeps us inside free-tier provider limits. The cache is a thin
 * interface so we can swap the in-memory dev impl for Redis without touching
 * call sites.
 */

import {
  CURRENCIES,
  FALLBACK_RATES,
  SUPPORTED_CURRENCIES,
  isCurrencyCode,
  type CurrencyCode,
} from './currency';

const RATE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FX_API = process.env.FX_API_URL ?? 'https://api.frankfurter.app/latest?from=USD';

export interface RatesResult {
  base: 'USD';
  rates: Partial<Record<CurrencyCode, number>>;
  /** Epoch ms the rates were fetched. */
  asOf: number;
  /** True when we fell back to the bundled table. */
  stale: boolean;
  source: 'live' | 'fallback' | 'cache';
}

// --- Cache abstraction -----------------------------------------------------
// Dev  : in-process Map.
// Prod : Redis via REDIS_URL. The client is dynamically imported so we don't
//        hard-depend on a TCP driver in the Edge runtime.

type CacheDriver = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
};

const memory = new Map<string, { value: string; expires: number }>();

const memoryDriver: CacheDriver = {
  async get(key) {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  },
  async set(key, value, ttlMs) {
    memory.set(key, { value, expires: Date.now() + ttlMs });
  },
};

let redisDriver: CacheDriver | null = null;
let redisInitialised = false;

/**
 * Loads the optional `redis` driver without a static import.
 *
 * A literal `import('redis')` would make the bundler try to resolve the module
 * at build time and warn (or fail) when it isn't installed. Resolving through
 * an indirection keeps `redis` genuinely optional: install it only if you
 * actually set REDIS_URL.
 */
const importOptional = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

async function createRedisClient(url: string): Promise<import('redis').RedisClient | null> {
  try {
    const mod = (await importOptional('redis')) as typeof import('redis');
    if (!mod?.createClient) return null;
    const client = mod.createClient({ url });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function getCache(): Promise<CacheDriver> {
  if (!process.env.REDIS_URL) return memoryDriver;
  if (redisInitialised && redisDriver) return redisDriver;
  redisInitialised = true;
  try {
    const client = await createRedisClient(process.env.REDIS_URL);
    if (!client) return memoryDriver;
    redisDriver = {
      async get(key) {
        return client.get(key);
      },
      async set(key, value, ttlMs) {
        await client.set(key, value, { PX: ttlMs });
      },
    };
    return redisDriver;
  } catch {
    // Redis unreachable -> degrade to memory rather than fail the request.
    return memoryDriver;
  }
}

// --- Rates -----------------------------------------------------------------

const CACHE_KEY = 'fx:USD:v1';

/** Coerces a provider payload into a validated rate table. */
function parseRates(json: unknown): Partial<Record<CurrencyCode, number>> {
  const raw = (json as { rates?: Record<string, number> } | null)?.rates;
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<CurrencyCode, number>> = { USD: 1 };
  for (const code of SUPPORTED_CURRENCIES) {
    const v = raw[code];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[code] = v;
  }
  return out;
}

export async function getUsdRates(): Promise<RatesResult> {
  const cache = await getCache();

  const cached = await cache.get(CACHE_KEY).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as RatesResult;
      return { ...parsed, source: 'cache' };
    } catch {
      /* corrupt cache entry, fall through to a live fetch */
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(FX_API, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      next: { revalidate: 3600 },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`FX provider responded ${res.status}`);

    const rates = parseRates(await res.json());
    if (Object.keys(rates).length < 2) throw new Error('FX provider returned no usable rates');

    const result: RatesResult = {
      base: 'USD',
      rates,
      asOf: Date.now(),
      stale: false,
      source: 'live',
    };
    await cache.set(CACHE_KEY, JSON.stringify(result), RATE_TTL_MS).catch(() => undefined);
    return result;
  } catch {
    const result: RatesResult = {
      base: 'USD',
      rates: FALLBACK_RATES,
      asOf: Date.now(),
      stale: true,
      source: 'fallback',
    };
    await cache.set(CACHE_KEY, JSON.stringify(result), RATE_TTL_MS).catch(() => undefined);
    return result;
  }
}

export async function getRate(target: CurrencyCode): Promise<number> {
  if (target === 'USD') return 1;
  const { rates } = await getUsdRates();
  return rates[target] ?? FALLBACK_RATES[target] ?? 1;
}

/** Snapshot of every rate, safe to serialise into a client prop. */
export async function getRateSnapshot(): Promise<{
  rates: Partial<Record<CurrencyCode, number>>;
  asOf: number;
  stale: boolean;
}> {
  const { rates, asOf, stale } = await getUsdRates();
  return { rates, asOf, stale };
}

// --- Conversion & formatting ----------------------------------------------

export interface Money {
  amount: number;
  currency: CurrencyCode;
  formatted: string;
}

/** Converts a USD base amount into a local amount with native rounding. */
export function convert(amountUsd: number, rate: number, code: CurrencyCode): number {
  const meta = CURRENCIES[code];
  const raw = amountUsd * rate;
  if (meta.roundTo <= 1) return Math.round(raw / meta.roundTo) * meta.roundTo;
  return Math.round(raw / meta.roundTo) * meta.roundTo;
}

export function formatMoney(amount: number, code: CurrencyCode, locale?: string): string {
  const meta = CURRENCIES[code];
  return new Intl.NumberFormat(locale ?? meta.locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  }).format(amount);
}

export async function toMoney(amountUsd: number, code: CurrencyCode, locale?: string): Promise<Money> {
  if (!isCurrencyCode(code)) code = 'USD';
  const rate = await getRate(code);
  const amount = convert(amountUsd, rate, code);
  return { amount, currency: code, formatted: formatMoney(amount, code, locale) };
}
