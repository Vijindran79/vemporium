/**
 * Auth configuration, separated from `auth.ts` so the constants can be read
 * (and tested) without pulling in the NextAuth runtime.
 */

const devFallback = 'dev-only-insecure-secret-change-me';

export const AUTH_SECRET = process.env.AUTH_SECRET || devFallback;

/** 8 hours. Body measurements are sensitive; long shared-device sessions are a risk. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * MUST stay 'jwt'.
 *
 * Auth.js refuses the Credentials provider under `strategy: 'database'` — it
 * throws `UnsupportedStrategy: Signing in with credentials only supported if JWT
 * strategy is enabled` from @auth/core/lib/utils/assert.js, at sign-in. So
 * password login and database sessions are mutually exclusive.
 *
 * This was configured the wrong way once and shipped broken: the config parsed,
 * the build passed, and every login attempt failed at runtime. Hence a named
 * constant and a test, rather than an inline string.
 *
 * The revocation that database sessions would have provided is recovered in
 * `auth.ts` via `User.sessionVersion`.
 */
export const SESSION_STRATEGY = 'jwt' as const;

/**
 * bcrypt cost factor. 12 is ~250ms per hash on current hardware: slow enough
 * to make offline cracking expensive, fast enough that a legitimate sign-in does
 * not feel broken.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * True when AUTH_SECRET is still the development fallback.
 *
 * Refusing to start in production without a real secret is deliberate: NextAuth
 * would otherwise sign cookies with a value that is published in this repo.
 */
export function usingInsecureSecret(): boolean {
  return AUTH_SECRET === devFallback;
}
