/**
 * Reviews section on the PDP.
 *
 * Server component: the review list is content, not interaction, so it should
 * arrive in the HTML rather than being fetched after paint. The write path
 * (leaving a review) is a separate client island.
 *
 * The summary deliberately leads with the FIT breakdown rather than the star
 * average. "Runs small, 2 of 4 buyers said so" is actionable; "4.1 stars" is
 * not. Both are shown, in that order of usefulness.
 */

import { rankHelpful, summarizeFit, summarizeReviews, type Review } from '@/lib/reviews';

function Stars({ value, count }: { value: number; count: number }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value} out of 5 from ${count} reviews`}>
      <span aria-hidden className="text-saffron">
        {'\u2605'.repeat(rounded)}
        <span className="text-stone-300">{'\u2605'.repeat(5 - rounded)}</span>
      </span>
    </span>
  );
}

function relativeTime(then: Date, now: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function ReviewPanel({ reviews }: { reviews: Review[] }) {
  const now = new Date();
  const summary = summarizeReviews(reviews);
  const fit = summarizeFit(reviews);
  const ranked = rankHelpful(reviews).slice(0, 8);

  return (
    <section id="reviews" className="border-t border-stone-200 pt-10">
      <h2 className="font-display text-2xl text-maroon">What buyers say</h2>

      <div className="mt-5 grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Summary rail */}
        <div className="card p-5">
          {summary.count === 0 ? (
            <>
              <p className="text-sm font-medium text-stone-700">No reviews yet</p>
              <p className="mt-1 text-xs text-stone-500">
                Be the first to tell other shoppers how this fits.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl text-maroon">{summary.average}</span>
                <span className="text-sm text-stone-500">out of 5</span>
              </div>
              <div className="mt-1">
                <Stars value={summary.average} count={summary.count} />
              </div>
              <p className="mt-1.5 text-xs text-stone-500">{summary.summary}</p>

              {/* Histogram */}
              <div className="mt-4 space-y-1">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const n = summary.distribution[star];
                  const pct = summary.count === 0 ? 0 : Math.round((n / summary.count) * 100);
                  return (
                    <div key={star} className="flex items-center gap-2 text-[11px]">
                      <span className="w-3 text-stone-500">{star}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <div className="h-full rounded-full bg-saffron" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-right text-stone-400">{n}</span>
                    </div>
                  );
                })}
              </div>

              {summary.photoShare > 0 && (
                <p className="mt-3 text-[11px] text-stone-500">
                  {Math.round(summary.photoShare * 100)}% include photos
                </p>
              )}
            </>
          )}
        </div>

        {/* Fit + list */}
        <div>
          {fit.verdict && (
            <div className="rounded-xl border border-gold/40 bg-gold/5 p-4">
              <h3 className="text-sm font-semibold text-stone-800">How it fits</h3>
              <p className="mt-1 text-sm text-stone-700">{fit.verdict}</p>
              <p className="mt-1 text-[11px] text-stone-500">
                Based on {fit.total} buyer{fit.total === 1 ? '' : 's'} who answered.
                {fit.lengthIssues > 0 && ` ${fit.lengthIssues} mentioned length.`}
              </p>
            </div>
          )}

          {ranked.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">
              No published reviews for this piece yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-5">
              {ranked.map((r) => (
                <li key={r.id} className="border-b border-stone-100 pb-5 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} count={1} />
                    <span className="text-xs text-stone-500">{relativeTime(r.createdAt, now)}</span>
                    {r.purchasedSize && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
                        Size {r.purchasedSize}
                      </span>
                    )}
                    {r.photoCount > 0 && (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] text-maroon">
                        {r.photoCount} photo{r.photoCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {r.body && <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{r.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
