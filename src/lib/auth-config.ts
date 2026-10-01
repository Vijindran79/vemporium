/**
 * Auth configuration, separated from `auth.ts` so the constants can be read
 * (and tested) without pulling in the NextAuth runtime.
 */

const devFallback = 'dev-only-insecure-secret-change-me';

export const AUTH_SECRET = process.env.AUTH_SECRET || devFallback;

/** 8 hours. Body measurements are sensitive; long shared-device sessions are a risk. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

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
