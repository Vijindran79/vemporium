import Stripe from 'stripe';

/**
 * Stripe server client.
 *
 * Key facts this module exists to enforce:
 *
 * 1. The secret key is SERVER ONLY. It must never reach a client component, so
 *    it lives here and nowhere under `src/components`.
 * 2. The client is constructed LAZILY. `next build` imports route modules to
 *    collect page data; building the SDK at module scope would demand an API
 *    key in the build environment, which should not be required to compile.
 * 3. The API version is pinned, so a Stripe-side default bump cannot change
 *    payload shapes underneath a running deploy.
 */

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. Cannot create or read payment intents.');
  }

  client = new Stripe(key, {
    // Pinned to the version this SDK was built against. A Stripe-side default
    // bump must not change payload shapes underneath a running deploy.
    apiVersion: '2026-09-30.endive',
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return client;
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Signing secret for inbound webhooks.
 *
 * Distinct from the publishable key. If this is missing in production the
 * webhook must refuse every request rather than fall back to "accept anything"
 * the way the legacy internal webhook does in dev.
 */
export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}