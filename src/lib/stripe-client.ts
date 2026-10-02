/**
 * Browser-side Stripe loader.
 *
 * Separate from src/lib/stripe.ts on purpose: that one holds the SECRET key and
 * must never be imported by anything that ends up in a client bundle. This file
 * is the only Stripe module a 'use client' component may touch.
 *
 * loadStripe is memoised in a module-level promise. Calling it per render
 * re-creates the Stripe instance and re-mounts PaymentElement, which wipes any
 * card details the shopper has already typed.
 */

'use client';

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      // Null rather than a throw: an unconfigured deployment should render the
      // rest of checkout, not a white screen.
      console.warn('[stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set; payment UI disabled.');
      stripePromise = Promise.resolve(null);
    } else {
      stripePromise = loadStripe(key);
    }
  }
  return stripePromise;
}

/** True when the publishable key is present. Lets the UI degrade honestly. */
export function stripePublishableKeyPresent(): boolean {
  return !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

/**
 * Where the checkout token lives between order creation and the confirmation
 * screen.
 *
 * sessionStorage, not localStorage: it is scoped to the tab and is cleared when
 * the tab closes, so a token does not outlive the checkout attempt it authorises.
 * Not a cookie, so it is never attached to outbound requests automatically.
 */
export const CHECKOUT_TOKEN_PREFIX = 'vemporium:checkout-token:';

export function storeCheckoutToken(orderId: string, token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${CHECKOUT_TOKEN_PREFIX}${orderId}`, token);
  } catch {
    // Private browsing or a full quota. The shopper can still pay if signed in.
  }
}

export function readCheckoutToken(orderId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(`${CHECKOUT_TOKEN_PREFIX}${orderId}`);
  } catch {
    return null;
  }
}

export function clearCheckoutToken(orderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${CHECKOUT_TOKEN_PREFIX}${orderId}`);
  } catch {
    /* nothing to do */
  }
}