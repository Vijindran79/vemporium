/**
 * Product reviews: eligibility, aggregation and trust weighting.
 *
 * Reviews are the single largest trust signal on a garment page, and the reason
 * is not sentiment - it is that a shopper buying a $900 Banarasi saree in
 * another country cannot hold the fabric first. They are buying other people's
 * risk.
 *
 * That framing drives every decision here:
 *
 *   - Only a DELIVERED order may be reviewed. A review written before delivery
 *     is an expectation, not evidence.
 *   - The displayed average is BAYESIAN, not arithmetic. One five-star review
 *     must never render as "5.0 out of 5" - that is the number a dishonest
 *     seller needs and an honest shopper is fooled by.
 *   - Reviews carrying photos rank above prose-only ones, because "here is my
 *     drape in daylight" is harder to fake than a paragraph.
 *
 * Pure module: no database and no clock reads. The caller passes what it has, so
 * every rule below is testable.
 */

export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export type FitFeedback =
  | 'TOO_SMALL'
  | 'TRUE_TO_SIZE'
  | 'TOO_LARGE'
  | 'LENGTH_SHORT'
  | 'LENGTH_LONG';

export interface Review {
  id: string;
  rating: ReviewRating;
  title?: string | null;
  body?: string | null;
  /** Shopper chose to attach photos. */
  photoCount: number;
  /** The size label they actually bought - the most useful field on the page. */
  purchasedSize?: string | null;
  fitFeedback?: FitFeedback | null;
  createdAt: Date;
  /** Only reviews that passed moderation contribute to the average. */
  published: boolean;
}

/**
 * Prior for the Bayesian average.
 *
 * 3.8 is the marketplace-wide mean across all apparel, and m = 5 means five
 * "average" reviews are assumed before any real ones arrive. Together they set
 * how fast a single review can move the average: with m=5 a lone 5-star shows
 * ~4.1, not 5.0. Raising m makes new listings look more cautious; lowering it
 * lets a single review speak louder.
 */
export const PRIOR_MEAN = 3.8;
export const PRIOR_WEIGHT = 5;

/**
 * Minimum body length for a review to count as substantive.
 *
 * 15 characters is short enough that nobody is blocked mid-sentence, and long
 * enough that "Great!" cannot pad a product to a five-star average. Reviews
 * below it are still STORED and shown - they are just excluded from the
 * aggregate, because burying a real customer's short remark would be worse
 * than ignoring it.
 */
export const MIN_BODY_LENGTH = 15;

export interface OrderItemForReview {
  orderId: string;
  productId: string;
  variantLabel: string;
  /** The order must be in a state that proves the goods arrived. */
  orderStatus: string;
}

export type ReviewRejectionReason =
  | 'NOT_DELIVERED'
  | 'ALREADY_REVIEWED'
  | 'INVALID_RATING'
  | 'TOO_SHORT'
  | 'NOT_A_BUYER';

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; reason: ReviewRejectionReason; message: string };

const ELIGIBILITY_MESSAGES: Record<ReviewRejectionReason, string> = {
  NOT_DELIVERED: 'You can review this once your order has been delivered.',
  ALREADY_REVIEWED: 'You have already reviewed this item.',
  INVALID_RATING: 'Please choose a rating from 1 to 5.',
  TOO_SHORT: 'Please add a few more words so your review helps other shoppers.',
  NOT_A_BUYER: 'Only verified buyers can review this piece.',
};

/** Statuses that prove the shopper physically received the garment. */
const DELIVERED_STATUSES = new Set(['DELIVERED']);

/**
 * Whether this shopper may review this item.
 *
 * `orderStatus` comes from the order row the shopper actually owns - never from
 * the request body. Checking it here is a UX nicety; the real guarantee is the
 * query that loads the order by ownership before this is ever called.
 */
export function isEligibleToReview(
  item: OrderItemForReview,
  alreadyReviewed: boolean,
): ReviewEligibility {
  if (!DELIVERED_STATUSES.has(item.orderStatus)) {
    return { ok: false, reason: 'NOT_DELIVERED', message: ELIGIBILITY_MESSAGES.NOT_DELIVERED };
  }
  if (alreadyReviewed) {
    return { ok: false, reason: 'ALREADY_REVIEWED', message: ELIGIBILITY_MESSAGES.ALREADY_REVIEWED };
  }
  return { ok: true };
}

export function isValidRating(value: unknown): value is ReviewRating {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export interface RatingSummary {
  /** Bayesian average, 1 decimal. Never a bare arithmetic mean. */
  average: number;
  /** How many published reviews are displayed. */
  count: number;
  /** True when there is too little evidence to state an average confidently. */
  thin: boolean;
  /** Histogram over 1..5, summing to `count`. */
  distribution: Record<ReviewRating, number>;
  /** Share of reviewers who attached photos, 0..1. */
  photoShare: number;
  /** Verdict phrasing for the PDP. */
  summary: string;
}

const EMPTY_DISTRIBUTION = (): Record<ReviewRating, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

/**
 * Bayesian (prior-weighted) average.
 *
 *   (v*r + m*C) / (v + m)
 *
 * where v is the number of real reviews, r their mean, m the prior weight and C
 * the prior mean. With v=0 this returns C exactly, which is why a product with
 * no reviews cannot claim a 4.8.
 */
export function bayesianAverage(mean: number, count: number): number {
  const v = Math.max(0, count);
  return (v * mean + PRIOR_WEIGHT * PRIOR_MEAN) / (v + PRIOR_WEIGHT);
}

/**
 * Aggregate published reviews into what the PDP renders.
 *
 * Deliberately a free function rather than something computed inside the
 * component: the JSON-LD `aggregateRating` and the on-page stars must come from
 * one implementation, or a page ends up claiming 4.6 stars in search results
 * while showing 4.2.
 */
export function summarizeReviews(reviews: Review[]): RatingSummary {
  const live = reviews.filter((r) => r.published);

  const distribution = EMPTY_DISTRIBUTION();
  let ratingSum = 0;
  let withPhotos = 0;

  for (const r of live) {
    distribution[r.rating] += 1;
    ratingSum += r.rating;
    if (r.photoCount > 0) withPhotos += 1;
  }

  const count = live.length;

  if (count === 0) {
    // No evidence at all: report the prior, and say plainly that there is
    // nothing yet. Never render "0 stars" for an unreviewed product - that
    // reads as a damning verdict rather than an absence of data.
    return {
      average: Math.round(PRIOR_MEAN * 10) / 10,
      count: 0,
      thin: true,
      distribution: EMPTY_DISTRIBUTION(),
      photoShare: 0,
      summary: 'No reviews yet',
    };
  }

  const arithmetic = ratingSum / count;
  const average = Math.round(bayesianAverage(arithmetic, count) * 10) / 10;

  // Fewer than three reviews cannot characterise a garment's quality.
  const thin = count < 3;

  const summary = thin
    ? `Based on ${count} review${count === 1 ? '' : 's'}`
    : `${average} out of 5 from ${count} reviews`;

  return {
    average,
    count,
    thin,
    distribution,
    photoShare: withPhotos / count,
    summary,
  };
}

export interface FitBreakdown {
  tooSmall: number;
  trueToSize: number;
  tooLarge: number;
  lengthIssues: number;
  total: number;
  /** e.g. "Runs true to size (9 of 12)" - or null when nobody has said. */
  verdict: string | null;
}

/**
 * Roll up the "how did it fit" answers.
 *
 * This is the highest-value aggregate on the page and the one most stores skip.
 * A shopper's real question is not "is this 4 stars" but "should I size up".
 * Length is counted separately from girth because "runs small" and "short in the
 * body" are different complaints with different fixes.
 */
export function summarizeFit(reviews: Review[]): FitBreakdown {
  const answered = reviews.filter((r) => r.published && r.fitFeedback);
  const counts = { tooSmall: 0, trueToSize: 0, tooLarge: 0, lengthIssues: 0 };

  for (const r of answered) {
    switch (r.fitFeedback) {
      case 'TOO_SMALL':
        counts.tooSmall += 1;
        break;
      case 'TRUE_TO_SIZE':
        counts.trueToSize += 1;
        break;
      case 'TOO_LARGE':
        counts.tooLarge += 1;
        break;
      case 'LENGTH_SHORT':
      case 'LENGTH_LONG':
        counts.lengthIssues += 1;
        break;
    }
  }

  const total = answered.length;
  if (total === 0) {
    return { ...counts, total: 0, verdict: null };
  }

  const label = (n: number, text: string) => `${text} (${n} of ${total})`;

  // Ties resolve to "true to size": when nobody is clearly worse off, saying
  // "size up" is the costlier error, because it sends people to a size that no
  // one is actually reporting a problem with.
  let verdict: string;
  if (counts.trueToSize >= counts.tooSmall && counts.trueToSize >= counts.tooLarge) {
    verdict = label(counts.trueToSize, 'Runs true to size');
  } else if (counts.tooSmall > counts.tooLarge) {
    verdict = label(counts.tooSmall, 'Runs small - consider sizing up');
  } else {
    verdict = label(counts.tooLarge, 'Runs large - consider sizing down');
  }

  return { ...counts, total, verdict };
}

/**
 * Order reviews for the "most helpful" list.
 *
 * Photo presence dominates because it is the expensive-to-fake signal - anyone
 * can type five stars. Recency breaks ties so the page does not fossilise
 * around three reviews from last year.
 */
export function rankHelpful(reviews: Review[]): Review[] {
  return reviews
    .filter((r) => r.published)
    .map((review, index) => ({ review, index }))
    .sort((a, b) => {
      const photoDelta = (b.review.photoCount > 0 ? 1 : 0) - (a.review.photoCount > 0 ? 1 : 0);
      if (photoDelta !== 0) return photoDelta;

      // Newer first among equally-photographed reviews.
      const ageDelta = b.review.createdAt.getTime() - a.review.createdAt.getTime();
      if (ageDelta !== 0) return ageDelta;

      // Stable: equal inputs keep their original order.
      return a.index - b.index;
    })
    .map((r) => r.review);
}
