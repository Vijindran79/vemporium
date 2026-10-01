/**
 * Localised payment routing.
 *
 * Shoppers convert best on a method they already trust. We pick a primary
 * method per market and keep Stripe/PayPal as the universal fallback so a
 * missing integration never blocks a sale.
 *
 * Order of preference is deliberate: local wallet first, then local card
 * scheme, then a global processor.
 */

export type PaymentProvider =
  | 'kakaopay' | 'naverpay' | 'toss'
  | 'paypay' | 'rakutenpay' | 'konbini'
  | 'klarna' | 'ideal' | 'bancontact' | 'multibanco' | 'sepa'
  | 'upi' | 'netbanking'
  | 'stripe' | 'paypal' | 'card';

export interface PaymentMethodOption {
  provider: PaymentProvider;
  label: string;
  /** Local amount minor units are handled by the PSP, we just pass decimals. */
  /** Two-decimal currencies require minor units; JPY/KRW are zero-decimal. */
  zeroDecimal: boolean;
  popular?: boolean;
}

interface MarketConfig {
  methods: PaymentMethodOption[];
}

const GLOBAL_FALLBACKS: PaymentMethodOption[] = [
  { provider: 'stripe', label: 'Credit or debit card', zeroDecimal: false, popular: true },
  { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
  { provider: 'card', label: 'Apple Pay / Google Pay', zeroDecimal: false },
];

export const MARKETS: Record<string, MarketConfig> = {
  KR: {
    methods: [
      { provider: 'kakaopay', label: 'KakaoPay', zeroDecimal: false, popular: true },
      { provider: 'naverpay', label: 'Naver Pay', zeroDecimal: false, popular: true },
      { provider: 'toss', label: 'Toss Pay', zeroDecimal: false },
      { provider: 'stripe', label: 'Credit or debit card', zeroDecimal: false },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
    ],
  },
  JP: {
    methods: [
      { provider: 'paypay', label: 'PayPay', zeroDecimal: true, popular: true },
      { provider: 'rakutenpay', label: 'Rakuten Pay', zeroDecimal: true },
      { provider: 'konbini', label: 'Convenience store', zeroDecimal: true },
      { provider: 'stripe', label: 'Credit card', zeroDecimal: true },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
    ],
  },
  GB: {
    methods: [
      { provider: 'stripe', label: 'Credit or debit card', zeroDecimal: false, popular: true },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false, popular: true },
    ],
  },
  DE: {
    methods: [
      { provider: 'ideal', label: 'iDEAL', zeroDecimal: false, popular: true },
      { provider: 'klarna', label: 'Klarna — pay in 3', zeroDecimal: false, popular: true },
      { provider: 'sepa', label: 'SEPA Direct Debit', zeroDecimal: false },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
      { provider: 'stripe', label: 'Credit card', zeroDecimal: false },
    ],
  },
  IN: {
    methods: [
      { provider: 'upi', label: 'UPI', zeroDecimal: false, popular: true },
      { provider: 'netbanking', label: 'Net banking', zeroDecimal: false },
      { provider: 'stripe', label: 'Credit card', zeroDecimal: false },
    ],
  },
  SG: {
    methods: [
      { provider: 'stripe', label: 'Credit or debit card', zeroDecimal: false, popular: true },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
    ],
  },
  BR: {
    methods: [
      { provider: 'stripe', label: 'Cartão de crédito', zeroDecimal: false, popular: true },
      { provider: 'paypal', label: 'PayPal', zeroDecimal: false },
    ],
  },
};

// Aliases so EU country codes all resolve to the DE/EU config.
const EU_ALIASES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','ES','FI','FR','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','SE',
]);

/** Methods to render at checkout for a destination country. */
export function paymentMethodsFor(country: string | null | undefined): PaymentMethodOption[] {
  if (!country) return GLOBAL_FALLBACKS;
  const code = country.toUpperCase();
  if (EU_ALIASES.has(code)) return MARKETS.DE.methods;
  return MARKETS[code]?.methods ?? GLOBAL_FALLBACKS;
}

/**
 * Converts a local-currency amount to the minor units a PSP expects.
 * Zero-decimal currencies (JPY, KRW) must NOT be multiplied by 100.
 */
export function toMinorUnits(amount: number, zeroDecimal: boolean): number {
  return zeroDecimal ? Math.round(amount) : Math.round(amount * 100);
}
