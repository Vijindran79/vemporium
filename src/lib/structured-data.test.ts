/**
 * Structured-data tests.
 *
 * The failure mode here is not a crash - it is emitting JSON-LD that disagrees
 * with the visible page. Google treats that as a manual action, so the important
 * assertions are about AGREEMENT, not shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { breadcrumbJsonLd, organizationJsonLd, productJsonLd } from './structured-data.ts';
import { CATALOG, type CatalogItem } from './catalog.ts';
import { summarizeReviews, type Review } from './reviews.ts';

const item: CatalogItem = CATALOG[0];

let seq = 0;
const review = (over: Partial<Review> = {}): Review => ({
  id: `r-${++seq}`,
  rating: 5,
  body: 'The zari is real gold thread, not plastic film.',
  photoCount: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  published: true,
  ...over,
});

// --- Product ---------------------------------------------------------------

test('the product schema declares the basics a merchant listing needs', () => {
  const d = productJsonLd(item, []);
  assert.equal(d['@type'], 'Product');
  assert.equal(d.name, item.title);
  assert.equal(d.sku, item.slug);
  assert.equal(d.category, item.categoryLabel);
  assert.equal(d.material, item.fabricLabel);
  assert.equal(d.brand.name, 'Vemporium');
});

test('the offer carries a price, currency and in-stock availability', () => {
  const d = productJsonLd(item, []);
  assert.equal(d.offers['@type'], 'Offer');
  assert.equal(d.offers.availability, 'https://schema.org/InStock');
  assert.ok(d.offers.price);
  assert.ok(d.offers.url.includes(item.slug));
});

test('the price is a plain decimal string, never a float tail', () => {
  // "189.00000000000003" is what Google rejects.
  const d = productJsonLd(item, []);
  assert.match(d.offers.price, /^\d+\.\d{2}$/);
  assert.equal(Number(d.offers.price), item.priceUsd);
});

test('a localised price is used when the market supplied one', () => {
  const d = productJsonLd(item, [], { priceLocal: 149.5, currency: 'GBP' });
  assert.equal(d.offers.price, '149.50');
  assert.equal(d.offers.priceCurrency, 'GBP');
});

test('every piece declares Indian origin', () => {
  assert.equal(productJsonLd(item, []).countryOfOrigin, 'IN');
});

// --- Ratings: must match the page ------------------------------------------

test('no aggregateRating is emitted when there are no reviews', () => {
  // Emitting the prior as a rating would be inventing a review. Not optional.
  const d = productJsonLd(item, []);
  assert.equal(d.aggregateRating, undefined);
  assert.equal(d.review, undefined);
});

test('the schema rating equals what summarizeReports the page will show', () => {
  // The single most important assertion here: two sources of truth for one
  // number is how a page gets a manual action.
  const reviews = [review(), review({ rating: 4 }), review({ rating: 5 })];
  const d = productJsonLd(item, reviews);
  const shown = summarizeReviews(reviews);

  assert.equal(d.aggregateRating?.ratingValue, shown.average.toFixed(1));
  assert.equal(d.aggregateRating?.reviewCount, shown.count);
});

test('the review count ignores unpublished reviews, as the page does', () => {
  const reviews = [review(), review({ published: false })];
  const d = productJsonLd(item, reviews);
  assert.equal(d.aggregateRating?.reviewCount, 1);
});

test('the rating bounds are declared', () => {
  const d = productJsonLd(item, [review()]);
  assert.equal(d.aggregateRating?.bestRating, 5);
  assert.equal(d.aggregateRating?.worstRating, 1);
});

test('individual reviews are emitted, capped, and bodyless ones skipped', () => {
  const many = Array.from({ length: 8 }, () => review());
  const withEmpty = [...many, review({ body: null })];

  const d = productJsonLd(item, many);
  assert.equal(d.review?.length, 5);

  const d2 = productJsonLd(item, withEmpty);
  for (const r of d2.review ?? []) {
    assert.notEqual(r.reviewBody, '');
  }
});

test('a review without a body is not emitted as an empty snippet', () => {
  const d = productJsonLd(item, [review({ body: null })]);
  assert.equal(d.review, undefined);
  // But the rating still counts - it is real evidence.
  assert.equal(d.aggregateRating?.reviewCount, 1);
});

test('review dates are ISO days, not full timestamps', () => {
  const d = productJsonLd(item, [review()]);
  const r = d.review?.[0];
  assert.match(String(r?.datePublished), /^\d{4}-\d{2}-\d{2}$/);
});

// --- Breadcrumbs and organization -----------------------------------------

test('breadcrumbs are numbered from one', () => {
  const d = breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Sarees', path: '/catalog' },
  ]);
  const items = d.itemListElement as Array<{ position: number }>;
  assert.equal(items[0].position, 1);
  assert.equal(items[1].position, 2);
});

test('breadcrumb entries are absolute URLs', () => {
  const d = breadcrumbJsonLd([{ name: 'Home', path: '/' }]);
  const items = d.itemListElement as Array<{ item: string }>;
  assert.ok(items[0].item.startsWith('http'));
});

test('the organization schema names the site and its url', () => {
  const d = organizationJsonLd();
  assert.equal(d['@type'], 'Organization');
  assert.equal(d.name, 'Vemporium');
  assert.ok(String(d.url).startsWith('http'));
});

// --- Whole-catalog sanity --------------------------------------------------

test('every catalog item produces valid product JSON', () => {
  // A single malformed product in the feed is enough to invalidate the batch.
  for (const product of CATALOG) {
    const d = productJsonLd(product, []);
    assert.ok(d.name.length > 0, `${product.slug} has no name`);
    assert.match(d.offers.price, /^\d+\.\d{2}$/);
    assert.ok(d.offers.url.includes(product.slug));
  }
});
