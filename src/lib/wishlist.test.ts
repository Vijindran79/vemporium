/**
 * Wishlist tests.
 *
 * The list is the highest-intent thing a shopper owns here, so the failures
 * that matter are the quiet ones: an item that vanishes without explanation,
 * or a "price drop" that is really just the exchange rate moving.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  entryKey,
  isSaved,
  priceDrops,
  pruneUnavailable,
  removeEntry,
  toggleEntry,
  type WishlistEntry,
} from './wishlist.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

let seq = 0;
const entry = (over: Partial<WishlistEntry> = {}): WishlistEntry => ({
  slug: `product-${++seq}`,
  title: 'Banarasi Silk Saree',
  priceUsd: 189,
  colourHex: '#7B1E3A',
  categoryLabel: 'Saree',
  fabricLabel: 'Banarasi brocade',
  originCity: 'Varanasi',
  savedAt: NOW,
  ...over,
});

// --- Identity --------------------------------------------------------------

test('slug identity is case and whitespace insensitive', () => {
  assert.equal(entryKey('  Banarasi-Saree '), 'banarasi-saree');
  assert.equal(entryKey('BANARASI-SAREE'), 'banarasi-saree');
});

test('two spellings of one slug are the same saved item', () => {
  const list = [entry({ slug: 'banarasi-saree' })];
  assert.equal(isSaved(list, 'BANARASI-SAREE'), true);
  assert.equal(isSaved(list, ' banarasi-saree '), true);
});

test('saving never duplicates an item under different casing', () => {
  const first = toggleEntry([], entry({ slug: 'banarasi-saree' }));
  const second = toggleEntry(first.entries, entry({ slug: 'BANARASI-SAREE' }));
  // Second toggle REMOVES, because it is the same item - not a third row.
  assert.equal(second.saved, false);
  assert.equal(second.entries.length, 0);
});

// --- Toggling --------------------------------------------------------------

test('saving adds the item and reports it saved', () => {
  const r = toggleEntry([], entry());
  assert.equal(r.saved, true);
  assert.equal(r.entries.length, 1);
});

test('saving again removes it', () => {
  const added = toggleEntry([], entry());
  const removed = toggleEntry(added.entries, added.entries[0]);
  assert.equal(removed.saved, false);
  assert.equal(removed.entries.length, 0);
});

test('the newest save is first in the list', () => {
  const a = toggleEntry([], entry({ slug: 'first' }));
  const b = toggleEntry(a.entries, entry({ slug: 'second' }));
  assert.equal(b.entries[0].slug, 'second');
});

test('toggling returns a new array and never mutates the input', () => {
  const original = [entry({ slug: 'a' })];
  const snapshot = original.length;
  toggleEntry(original, entry({ slug: 'b' }));
  assert.equal(original.length, snapshot);
  assert.notEqual(original, toggleEntry(original, entry({ slug: 'b' })).entries);
});

test('removing an item that is not saved leaves the list intact', () => {
  // This is the double-click case: it must not wipe everything.
  const list = [entry({ slug: 'a' }), entry({ slug: 'b' })];
  const after = removeEntry(list, 'not-here');
  assert.equal(after.length, 2);
});

test('a full list can be emptied one item at a time', () => {
  let list: WishlistEntry[] = [];
  for (const slug of ['a', 'b', 'c']) {
    list = toggleEntry(list, entry({ slug })).entries;
  }
  assert.equal(list.length, 3);
  for (const slug of ['a', 'b', 'c']) {
    list = removeEntry(list, slug);
  }
  assert.equal(list.length, 0);
});

// --- Price drops -----------------------------------------------------------

test('a genuine price drop is reported', () => {
  const list = [entry({ slug: 'saree', priceUsd: 189 })];
  const drops = priceDrops(list, { saree: 149 });
  assert.equal(drops.length, 1);
  assert.equal(drops[0].deltaUsd, -40);
  assert.equal(drops[0].dropped, true);
});

test('an unchanged price produces no alert', () => {
  const list = [entry({ slug: 'saree', priceUsd: 189 })];
  assert.equal(priceDrops(list, { saree: 189 }).length, 0);
});

test('a price INCREASE produces no alert', () => {
  // Unsolicited "your saved item got dearer" is pure annoyance and trains
  // people to ignore the channel, losing us the drop alerts that earn money.
  const list = [entry({ slug: 'saree', priceUsd: 189 })];
  assert.equal(priceDrops(list, { saree: 249 }).length, 0);
});

test('a delisted product is not reported as free', () => {
  // Missing from the catalog means gone, not price 0.
  const list = [entry({ slug: 'saree', priceUsd: 189 })];
  assert.equal(priceDrops(list, {}).length, 0);
});

test('a non-finite catalog price is ignored rather than alerted on', () => {
  const list = [entry({ slug: 'saree', priceUsd: 189 })];
  assert.equal(priceDrops(list, { saree: NaN }).length, 0);
  assert.equal(priceDrops(list, { saree: undefined as unknown as number }).length, 0);
});

test('the biggest saving is listed first', () => {
  const list = [
    entry({ slug: 'small', priceUsd: 100 }),
    entry({ slug: 'big', priceUsd: 500 }),
  ];
  const drops = priceDrops(list, { small: 95, big: 300 });
  assert.equal(drops[0].slug, 'big');
  assert.equal(drops[0].deltaUsd, -200);
});

test('only the dropped items appear', () => {
  const list = [entry({ slug: 'dropped', priceUsd: 100 }), entry({ slug: 'same', priceUsd: 100 })];
  const drops = priceDrops(list, { dropped: 80, same: 100 });
  assert.equal(drops.length, 1);
  assert.equal(drops[0].slug, 'dropped');
});
test('deltas are rounded to whole cents', () => {
  const list = [entry({ slug: 's', priceUsd: 100 })];
  const drops = priceDrops(list, { s: 89.995 });
  assert.equal(drops.length, 1);
  assert.equal(Math.round((drops[0].deltaUsd as number) * 100) / 100, drops[0].deltaUsd);
});

// --- Pruning ---------------------------------------------------------------

test('pruning keeps live items and reports what went away', () => {
  const list = [entry({ slug: 'live' }), entry({ slug: 'gone' })];
  const r = pruneUnavailable(list, new Set(['live']));
  assert.equal(r.entries.length, 1);
  assert.equal(r.removed.length, 1);
  // The removed one is reported rather than silently vanishing.
  assert.equal(r.removed[0].slug, 'gone');
});

test('pruning preserves the original ordering of survivors', () => {
  const list = [entry({ slug: 'a' }), entry({ slug: 'b' }), entry({ slug: 'c' })];
  const r = pruneUnavailable(list, new Set(['a', 'c']));
  assert.deepEqual(r.entries.map((e) => e.slug), ['a', 'c']);
});

test('pruning matches slugs case-insensitively', () => {
  const list = [entry({ slug: 'Saree' })];
  const r = pruneUnavailable(list, new Set(['saree']));
  assert.equal(r.removed.length, 0);
  assert.equal(r.entries.length, 1);
});

test('pruning an all-available list removes nothing', () => {
  const list = [entry({ slug: 'a' }), entry({ slug: 'b' })];
  const r = pruneUnavailable(list, new Set(['a', 'b']));
  assert.equal(r.removed.length, 0);
  assert.equal(r.entries.length, 2);
});
