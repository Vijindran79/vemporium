/**
 * Product-review tests.
 *
 * These guard the numbers a shopper is asked to trust. The one that matters
 * most is the first: a single five-star review must never be allowed to display
 * as "5.0 out of 5", because that is the whole prize for review fraud.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bayesianAverage,
  isEligibleToReview,
  isValidRating,
  PRIOR_MEAN,
  rankHelpful,
  summarizeFit,
  summarizeReviews,
  type OrderItemForReview,
  type Review,
  type ReviewRating,
} from './reviews.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

let seq = 0;
const review = (over: Partial<Review> = {}): Review => ({
  id: `r-${++seq}`,
  rating: 5,
  body: 'The zari is real and the drape is beautiful.',
  photoCount: 0,
  purchasedSize: 'M',
  fitFeedback: 'TRUE_TO_SIZE',
  createdAt: NOW,
  published: true,
  ...over,
});

const fiveStars = (n: number, over: Partial<Review> = {}): Review[] =>
  Array.from({ length: n }, () => review({ rating: 5 as ReviewRating, ...over }));

// --- Bayesian averaging ----------------------------------------------------

test('a product with no reviews reports the prior, never zero', () => {
  // "0 stars" would read as a damning verdict; the prior reads as "no data yet".
  const s = summarizeReviews([]);
  assert.equal(s.count, 0);
  assert.equal(s.average, PRIOR_MEAN);
  assert.equal(s.thin, true);
  assert.equal(s.summary, 'No reviews yet');
});

test('one perfect review does NOT display as 5.0', () => {
  // The single most important assertion in this file.
  const s = summarizeReviews(fiveStars(1));
  assert.ok(s.average < 5, `lone 5-star showed ${s.average}`);
  // A lone perfect review lands on 4.0: clearly visible, but not a 5-star claim.
  assert.ok(s.average >= 4, "prior dragged it too far down: " + s.average);
});
test('two perfect reviews still do not reach 5.0', () => {
  assert.ok(summarizeReviews(fiveStars(2)).average < 5);
});

test('enough consistent reviews approach the true average', () => {
  // With 50 five-star reviews the prior is a rounding error.
  const s = summarizeReviews(fiveStars(50));
  assert.ok(s.average >= 4.8, "expected ~4.9, got " + s.average);
});

test('a burst of one-star reviews is pulled toward the prior, not echoed', () => {
  const s = summarizeReviews(fiveStars(3, { rating: 1 }));
  assert.ok(s.average > 1, 'should not bottom out at the raw mean');
});

test('bayesianAverage with zero count returns the prior exactly', () => {
  assert.equal(bayesianAverage(0, 0), PRIOR_MEAN);
  assert.equal(bayesianAverage(99, 0), PRIOR_MEAN);
});

test('bayesianAverage is monotonic in the evidence', () => {
  // More agreeing reviews must always pull the number closer to their mean.
  let previous = 0;
  for (const count of [1, 2, 5, 10, 20, 50]) {
    const value = bayesianAverage(5, count);
    assert.ok(value >= previous, `not monotonic at count=${count}`);
    previous = value;
  }
});

test('a negative count is treated as zero', () => {
  assert.equal(bayesianAverage(4, -10), PRIOR_MEAN);
});

// --- Summary shape ---------------------------------------------------------

test('the distribution always sums to the review count', () => {
  const s = summarizeReviews([
    review({ rating: 5 }),
    review({ rating: 5 }),
    review({ rating: 3 }),
    review({ rating: 1 }),
  ]);
  const total = s.distribution[1] + s.distribution[2] + s.distribution[3] +
    s.distribution[4] + s.distribution[5];
  assert.equal(total, s.count);
  assert.equal(s.count, 4);
});

test('unpublished reviews are excluded from the count and the average', () => {
  // Moderation must actually move the number, or a hidden bad review still counts.
  const s = summarizeReviews([
    review({ rating: 5 }),
    review({ rating: 1, published: false }),
  ]);
  assert.equal(s.count, 1);
  assert.equal(s.distribution[1], 0);
  assert.ok(s.average >= 4, "hidden bad review should not drag the average to " + s.average);
});

test('fewer than three reviews is flagged thin', () => {
  assert.equal(summarizeReviews(fiveStars(2)).thin, true);
  assert.equal(summarizeReviews(fiveStars(3)).thin, false);
});

test('a thin summary does not quote a star figure', () => {
  assert.equal(summarizeReviews(fiveStars(1)).summary, 'Based on 1 review');
  assert.ok(!/out of 5/.test(summarizeReviews(fiveStars(2)).summary));
});

test('a well-reviewed summary quotes the figure and the count', () => {
  const s = summarizeReviews(fiveStars(12));
  assert.ok(/out of 5 from 12 reviews/.test(s.summary));
});

test('photo share reflects how many reviewers sent photos', () => {
  const s = summarizeReviews([
    review({ photoCount: 3 }),
    review({ photoCount: 1 }),
    review({ photoCount: 0 }),
    review({ photoCount: 0 }),
  ]);
  assert.equal(s.photoShare, 0.5);
});

// --- Eligibility -----------------------------------------------------------

test('only a delivered order may be reviewed', () => {
  const item: OrderItemForReview = {
    orderId: 'o1',
    productId: 'p1',
    variantLabel: 'M',
    orderStatus: 'DELIVERED',
  };
  assert.equal(isEligibleToReview(item, false).ok, true);
});

test('an in-flight order cannot be reviewed yet', () => {
  for (const status of ['PENDING_PAYMENT', 'PAID', 'FULFILLING', 'DISPATCHED', 'SHIPPED']) {
    const e = isEligibleToReview(
      { orderId: 'o1', productId: 'p1', variantLabel: 'M', orderStatus: status },
      false,
    );
    assert.equal(e.ok, false, `status ${status} should not be reviewable`);
    if (!e.ok) assert.equal(e.reason, 'NOT_DELIVERED');
  }
});

test('a cancelled or refunded order cannot be reviewed', () => {
  for (const status of ['CANCELLED', 'REFUNDED']) {
    const e = isEligibleToReview(
      { orderId: 'o1', productId: 'p1', variantLabel: 'M', orderStatus: status },
      false,
    );
    assert.equal(e.ok, false);
  }
});

test('one review per order item is enforced', () => {
  const item: OrderItemForReview = {
    orderId: 'o1',
    productId: 'p1',
    variantLabel: 'M',
    orderStatus: 'DELIVERED',
  };
  const e = isEligibleToReview(item, true);
  assert.equal(e.ok, false);
  if (!e.ok) assert.equal(e.reason, 'ALREADY_REVIEWED');
});

test('every refusal explains itself to the shopper', () => {
  const e = isEligibleToReview(
    { orderId: 'o1', productId: 'p1', variantLabel: 'M', orderStatus: 'PAID' },
    false,
  );
  assert.equal(e.ok, false);
  if (!e.ok) assert.ok(e.message.length > 0);
});

// --- Rating validation -----------------------------------------------------

test('only whole numbers 1-5 are valid ratings', () => {
  assert.equal(isValidRating(1), true);
  assert.equal(isValidRating(5), true);
  assert.equal(isValidRating(0), false);
  assert.equal(isValidRating(6), false);
  assert.equal(isValidRating(4.5), false);
  assert.equal(isValidRating('5'), false);
  assert.equal(isValidRating(null), false);
  assert.equal(isValidRating(undefined), false);
  assert.equal(isValidRating(NaN), false);
});

// --- Fit feedback ----------------------------------------------------------

test('fit feedback is summarised into a plain-English verdict', () => {
  const s = summarizeFit([
    review({ fitFeedback: 'TRUE_TO_SIZE' }),
    review({ fitFeedback: 'TRUE_TO_SIZE' }),
    review({ fitFeedback: 'TOO_SMALL' }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.trueToSize, 2);
  assert.ok(s.verdict?.includes('true to size'));
});

test('a minority of small-fit reports flips the advice to size up', () => {
  // 2 small against 1 true is the signal a shopper most needs.
  const s = summarizeFit([
    review({ fitFeedback: 'TOO_SMALL' }),
    review({ fitFeedback: 'TOO_SMALL' }),
    review({ fitFeedback: 'TRUE_TO_SIZE' }),
  ]);
  assert.equal(s.tooSmall, 2);
  assert.ok(s.verdict?.includes('sizing up'));
});

test('a fit tie resolves to true to size, not to sizing up', () => {
  // Telling someone to size up on no evidence is the costlier error.
  const s = summarizeFit([
    review({ fitFeedback: 'TOO_SMALL' }),
    review({ fitFeedback: 'TRUE_TO_SIZE' }),
  ]);
  assert.ok(s.verdict?.includes('true to size'));
});

test('length complaints are counted apart from girth complaints', () => {
  const s = summarizeFit([
    review({ fitFeedback: 'LENGTH_SHORT' }),
    review({ fitFeedback: 'LENGTH_LONG' }),
    review({ fitFeedback: 'TRUE_TO_SIZE' }),
  ]);
  assert.equal(s.lengthIssues, 2);
  // A length complaint is not evidence the girth runs small.
  assert.equal(s.tooSmall, 0);
});

test('nobody answering fit gives no verdict at all', () => {
  const s = summarizeFit([review({ fitFeedback: null }), review({ fitFeedback: null })]);
  assert.equal(s.total, 0);
  assert.equal(s.verdict, null);
});

test('fit totals ignore unpublished reviews', () => {
  const s = summarizeFit([
    review({ fitFeedback: 'TOO_SMALL' }),
    review({ fitFeedback: 'TOO_SMALL', published: false }),
  ]);
  assert.equal(s.total, 1);
});

test('a large sample still reads as true to size', () => {
  const s = summarizeFit(Array.from({ length: 20 }, () => review({ fitFeedback: 'TRUE_TO_SIZE' })));
  assert.equal(s.total, 20);
  assert.ok(s.verdict?.includes('20 of 20'));
});

// --- Ranking ---------------------------------------------------------------

test('reviews with photos outrank prose-only reviews', () => {
  const withPhoto = review({ photoCount: 2, createdAt: new Date('2020-01-01') });
  const without = review({ photoCount: 0, createdAt: NOW });
  const ranked = rankHelpful([without, withPhoto]);
  assert.equal(ranked[0].id, withPhoto.id);
});

test('newer reviews break ties between equally-photographed reviews', () => {
  const older = review({ photoCount: 1, createdAt: new Date('2024-01-01') });
  const newer = review({ photoCount: 1, createdAt: new Date('2026-01-01') });
  const ranked = rankHelpful([older, newer]);
  assert.equal(ranked[0].id, newer.id);
});

test('unpublished reviews never appear in the helpful list', () => {
  const hidden = review({ published: false, photoCount: 9 });
  const ranked = rankHelpful([hidden]);
  assert.equal(ranked.length, 0);
});

test('ranking does not mutate the input array', () => {
  const input = [
    review({ photoCount: 0, createdAt: NOW }),
    review({ photoCount: 3, createdAt: new Date('2020-01-01') }),
  ];
  const originalFirst = input[0].id;
  rankHelpful(input);
  assert.equal(input[0].id, originalFirst);
});

test('ranking is stable for identical reviews', () => {
  const a = review({ photoCount: 1 });
  const b = review({ photoCount: 1 });
  const ranked = rankHelpful([a, b]);
  assert.equal(ranked[0].id, a.id);
  assert.equal(ranked[1].id, b.id);
});
