/**
 * Market reference data.
 *
 * Deliberately NOT in a 'use client' module. Next replaces every export of a
 * client module with a client reference when a server component imports it, so
 * plain data imported from one silently arrives as `undefined` on the server —
 * which is exactly the bug that made the hero print a raw "KR" instead of
 * "South Korea". Server components need this, so it lives in a plain module and
 * the store re-exports it for client code.
 */

export const MARKET_COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: 'KR', name: 'South Korea', flag: '\u{1F1F0}\u{1F1F7}' },
  { code: 'JP', name: 'Japan', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'GB', name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'DE', name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'FR', name: 'France', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'US', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'CA', name: 'Canada', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'AU', name: 'Australia', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'SG', name: 'Singapore', flag: '\u{1F1F8}\u{1F1EC}' },
  { code: 'AE', name: 'United Arab Emirates', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'IN', name: 'India', flag: '\u{1F1EE}\u{1F1F3}' },
];

/** ISO-2 -> display name, for server-rendered copy. */
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  MARKET_COUNTRIES.map((c) => [c.code, c.name]),
);

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
];
