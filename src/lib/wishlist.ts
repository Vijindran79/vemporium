/**
 * Wishlist rules.
 *
 * Kept separate from the store that persists it, because the two interesting
 * questions here are not about state - they are about WHICH item a save
 * actually refers to, and what happens when the catalog changes underneath a
 * saved list.
 *
 * A wishlist is the highest-intent surface a store has: it is a shopper
 * telling us what they came back for. So it must survive a refresh, and it must
 * never silently drop what was in it.
 */

export interface WishlistEntry {
  slug: string;
  title: string;
  /** Base price in USD at the time it was saved. */
  priceUsd: number;
  colourHex: string;
  accentHex?: string;
  categoryLabel: string;
  fabricLabel: string;
  originCity: string;
  savedAt: Date;
}

/**
 * Identity of a saved item.
 *
 * slug alone, deliberately. Two colourways of the same saree are one product to
 * a shopper building a shortlist - they want to come back and decide between
 * them, not maintain two rows that are really one decision.
 */
export function entryKey(slug: string): string {
  return slug.trim().toLowerCase();
}

/** Add or remove, returning the new list and whether the item is now saved. */
export interface ToggleResult {
  entries: WishlistEntry[];
  saved: boolean;
}

/**
 * Toggle an item's saved state.
 *
 * Returns a NEW array rather than mutating, so a persisted store can diff it
 * and a React subscriber re-renders. Removing returns the list without the
 * entry; it never returns an empty list for an entry that was not there, which
 * would let a double-click wipe the whole list.
 */
export function toggleEntry(entries: WishlistEntry[], entry: WishlistEntry): ToggleResult {
  const key = entryKey(entry.slug);
  const exists = entries.some((e) => entryKey(e.slug) === key);

  if (exists) {
    return { entries: entries.filter((e) => entryKey(e.slug) !== key), saved: false };
  }

  // Newest first: the item you just saved is the one you came back for.
  return { entries: [entry, ...entries], saved: true };
}

export function isSaved(entries: WishlistEntry[], slug: string): boolean {
  const key = entryKey(slug);
  return entries.some((e) => entryKey(e.slug) === key);
}

export function removeEntry(entries: WishlistEntry[], slug: string): WishlistEntry[] {
  const key = entryKey(slug);
  return entries.filter((e) => entryKey(e.slug) !== key);
}

export interface PriceMovement {
  slug: string;
  title: string;
  wasUsd: number;
  nowUsd: number;
  /** Negative means it got cheaper. */
  deltaUsd: number;
  /** True only for a price DROP - the one alert worth sending. */
  dropped: boolean;
}

/**
 * Compare saved prices against the current catalog.
 *
 * Only price DROPS produce a notification. A saved-list "price went up" alert is
 * pure annoyance - it generates unsubscribes and teaches people to ignore the
 * channel, which then loses them the drop alerts that actually earn money.
 *
 * Compared in USD base, not local currency: a shopper switching GBP -> EUR must
 * not see their own wishlist items appear to "drop" by 15%. The FX display is a
 * presentation concern, applied on top of this.
 */
export function priceDrops(
  entries: WishlistEntry[],
  currentPriceBySlug: Record<string, number>,
): PriceMovement[] {
  const moves: PriceMovement[] = [];

  for (const entry of entries) {
    const nowUsd = currentPriceBySlug[entryKey(entry.slug)];
    // An item missing from the catalog is delisted, not free.
    if (typeof nowUsd !== 'number' || !Number.isFinite(nowUsd)) continue;

    const deltaUsd = Math.round((nowUsd - entry.priceUsd) * 100) / 100;
    if (deltaUsd >= 0) continue;

    moves.push({
      slug: entry.slug,
      title: entry.title,
      wasUsd: entry.priceUsd,
      nowUsd,
      deltaUsd,
      dropped: true,
    });
  }

  // Largest saving first, so the best offer is the one shown at the top.
  return moves.sort((a, b) => a.deltaUsd - b.deltaUsd);
}

/**
 * Drop entries whose product has left the catalog.
 *
 * Returns the survivors plus what was removed, so the UI can say "2 pieces are
 * no longer available" instead of silently shrinking the list — a shopper whose
 * shortlist quietly lost items will assume the site is broken.
 */
export interface PruneResult {
  entries: WishlistEntry[];
  removed: WishlistEntry[];
}

export function pruneUnavailable(
  entries: WishlistEntry[],
  availableSlugs: Set<string>,
): PruneResult {
  const kept: WishlistEntry[] = [];
  const removed: WishlistEntry[] = [];

  for (const entry of entries) {
    if (availableSlugs.has(entryKey(entry.slug))) kept.push(entry);
    else removed.push(entry);
  }

  return { entries: kept, removed };
}
