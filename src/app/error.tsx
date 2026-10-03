'use client';

/**
 * Route-level error boundary.
 *
 * Without this, any unhandled render error in a route segment produces a blank
 * white page. That is the worst possible failure for a store: the shopper has
 * already decided to buy, and a blank page reads as "this site is unsafe" rather
 * than "something broke".
 *
 * Two things matter here:
 *   - We never show the error message. It can leak a query, a URL or an id.
 *   - We give a real way out. A retry that re-runs the render is genuinely
 *     useful for a transient fetch failure, which is the common case.
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side only, and the message is deliberately not shown to the user.
    console.error('[route error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
      <p className="label-xs">Something went wrong</p>
      <h1 className="mt-3 font-display text-3xl text-maroon">
        We could not load this page.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-stone-600">
        This is on us, not on you. Nothing in your bag or your account has been
        affected.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back to the shop
        </Link>
        <Link href="/catalog" className="btn-ghost">
          Browse the collection
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 text-[11px] text-stone-400">
          Reference: {error.digest}
        </p>
      )}
    </main>
  );
}
