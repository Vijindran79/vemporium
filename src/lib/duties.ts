/**
 * Landed-cost calculator (duties, import VAT, shipping, de minimis thresholds).
 *
 * This is the single most conversion-critical number on the product: a shopper
 * in the UK who discovers a 20% duty at the last step abandons the cart.
 * We therefore show a full breakdown before payment.
 *
 * IMPORTANT: these bands are a starting approximation, not tax advice. Before
 * real launch, replace with a proper duty engine (Tactivo/EU Customs reform)
 * and confirm each rate with a customs broker for your shipping modes.
 */

export interface DutyBand {
  country: string;
  /**
   * Below this declared value (USD) an IMPORT is admitted duty- and VAT-free.
   * Only applies to cross-border shipments.
   */
  deMinimisUsd: number;
  /** Duty as a fraction of goods value. Zero for domestic sales. */
  dutyRate: number;
  /** Import VAT/GST as a fraction of (goods + duty). */
  taxRate: number;
  /** Flat courier cost in USD for a typical 1kg parcel. */
  shippingUsd: number;
  /** Handling / return-processing fee in USD. */
  handlingUsd: number;
  /**
   * Domestic sale: no customs duty and no import VAT, but the destination's
   * own consumption tax (GST here) still applies. Domestic orders must never
   * be de-minimised away.
   */
  domestic?: boolean;
}

/** Indicative bands for the launch markets. */
export const DUTY_BANDS: Record<string, DutyBand> = {
  US: { country: 'US', deMinimisUsd: 800, dutyRate: 0.0,   taxRate: 0.0,   shippingUsd: 18, handlingUsd: 3 },
  CA: { country: 'CA', deMinimisUsd: 150, dutyRate: 0.09, taxRate: 0.05, shippingUsd: 22, handlingUsd: 3 },
  GB: { country: 'GB', deMinimisUsd: 135, dutyRate: 0.12, taxRate: 0.20, shippingUsd: 20, handlingUsd: 4 },
  EU: { country: 'EU', deMinimisUsd: 150, dutyRate: 0.12, taxRate: 0.21, shippingUsd: 20, handlingUsd: 4 },
  KR: { country: 'KR', deMinimisUsd: 200, dutyRate: 0.08, taxRate: 0.10, shippingUsd: 16, handlingUsd: 3 },
  JP: { country: 'JP', deMinimisUsd: 100, dutyRate: 0.09, taxRate: 0.10, shippingUsd: 18, handlingUsd: 3 },
  IN: { country: 'IN', deMinimisUsd: 999999, dutyRate: 0.0, taxRate: 0.05, shippingUsd: 6, handlingUsd: 0, domestic: true },
  BR: { country: 'BR', deMinimisUsd: 50, dutyRate: 0.6, taxRate: 0.18, shippingUsd: 28, handlingUsd: 5 },
  ZA: { country: 'ZA', deMinimisUsd: 200, dutyRate: 0.2, taxRate: 0.15, shippingUsd: 24, handlingUsd: 4 },
  NZ: { country: 'NZ', deMinimisUsd: 200, dutyRate: 0.1, taxRate: 0.15, shippingUsd: 24, handlingUsd: 4 },
  CH: { country: 'CH', deMinimisUsd: 200, dutyRate: 0.08, taxRate: 0.08, shippingUsd: 26, handlingUsd: 5 },
  MX: { country: 'MX', deMinimisUsd: 50, dutyRate: 0.15, taxRate: 0.16, shippingUsd: 26, handlingUsd: 5 },
  SE: { country: 'SE', deMinimisUsd: 200, dutyRate: 0.1, taxRate: 0.25, shippingUsd: 22, handlingUsd: 4 },
  NO: { country: 'NO', deMinimisUsd: 200, dutyRate: 0.1, taxRate: 0.25, shippingUsd: 22, handlingUsd: 4 },
  DK: { country: 'DK', deMinimisUsd: 200, dutyRate: 0.1, taxRate: 0.25, shippingUsd: 22, handlingUsd: 4 },
  PL: { country: 'PL', deMinimisUsd: 150, dutyRate: 0.12, taxRate: 0.23, shippingUsd: 20, handlingUsd: 4 },
  TR: { country: 'TR', deMinimisUsd: 200, dutyRate: 0.1, taxRate: 0.20, shippingUsd: 24, handlingUsd: 4 },
  CN: { country: 'CN', deMinimisUsd: 50, dutyRate: 0.13, taxRate: 0.13, shippingUsd: 20, handlingUsd: 4 },
  HK: { country: 'HK', deMinimisUsd: 200, dutyRate: 0.0, taxRate: 0.0, shippingUsd: 18, handlingUsd: 3 },
  AU: { country: 'AU', deMinimisUsd: 1000, dutyRate: 0.05, taxRate: 0.10, shippingUsd: 22, handlingUsd: 3 },
  SG: { country: 'SG', deMinimisUsd: 400, dutyRate: 0.09, taxRate: 0.09, shippingUsd: 15, handlingUsd: 3 },
  AE: { country: 'AE', deMinimisUsd: 300, dutyRate: 0.05, taxRate: 0.05, shippingUsd: 24, handlingUsd: 4 },
};

const EU_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);

export function bandForCountry(country: string | null | undefined): DutyBand {
  if (!country) return DUTY_BANDS.US;
  const code = country.toUpperCase();
  if (EU_COUNTRIES.has(code)) return DUTY_BANDS.EU;
  return DUTY_BANDS[code] ?? DUTY_BANDS.US;
}

export interface LandedCostBreakdown {
  goodsUsd: number;
  dutyUsd: number;
  taxUsd: number;
  shippingUsd: number;
  handlingUsd: number;
  totalUsd: number;
  deMinimisApplied: boolean;
  band: DutyBand;
}

/**
 * @param goodsUsd declared value of the goods in USD.
 * @param country  ISO-2 destination.
 */
export function calculateLandedCost(goodsUsd: number, country: string | null | undefined): LandedCostBreakdown {
  const band = bandForCountry(country);

  // De minimis is an IMPORT concession. A domestic sale is never subject to
  // it — that is what stops us accidentally charging an Indian customer zero
  // GST on an order that should be taxed at 5%.
  const deMinimisApplied = !band.domestic && goodsUsd <= band.deMinimisUsd;

  const dutyUsd = band.domestic ? 0 : deMinimisApplied ? 0 : round2(goodsUsd * band.dutyRate);

  // Above the threshold, import tax is levied on the dutiable value
  // (goods + duty). Domestic GST is levied on the goods value alone.
  const taxBase = band.domestic ? goodsUsd : goodsUsd + dutyUsd;
  const taxUsd = deMinimisApplied ? 0 : round2(taxBase * band.taxRate);
  const shippingUsd = band.shippingUsd;
  const handlingUsd = band.handlingUsd;

  return {
    goodsUsd: round2(goodsUsd),
    dutyUsd,
    taxUsd,
    shippingUsd,
    handlingUsd,
    totalUsd: round2(goodsUsd + dutyUsd + taxUsd + shippingUsd + handlingUsd),
    deMinimisApplied,
    band,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
