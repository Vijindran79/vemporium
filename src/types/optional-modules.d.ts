/**
 * Ambient declaration for the OPTIONAL `redis` driver.
 *
 * The FX cache works without Redis (it degrades to an in-process Map), so we
 * deliberately do not add it as a hard dependency — that keeps the app
 * installable and deployable to the Edge runtime with zero native modules.
 * If you set REDIS_URL, run `npm i redis` and the dynamic import in
 * src/lib/fx.ts will resolve against these types.
 */
declare module 'redis' {
  export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
    connect(): Promise<unknown>;
  }
  export function createClient(options: { url: string }): RedisClient;
}
