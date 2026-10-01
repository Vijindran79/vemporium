/**
 * Business-logic unit tests.
 *
 * Run with:  npm test   (node:test is built in, so no test-runner dependency)
 *
 * These cover the rules that lose money when wrong: replenishment (over-order
 * floods a workshop; under-order loses a sale) and size recommendation (wrong
 * size is the top driver of ethnic-wear returns).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMovement,
  deriveStatus,
  evaluateReorder,
  nextPurchaseOrderReference,
  targetStockLevel,
  type SkuState,
} from './inventory.ts';
import { recommendSize, defaultBody, isKid, isMens, bmi, SIZE_ORDER, type BodyParams } from './sizing.ts';
import { calculateLandedCost, bandForCountry } from './duties.ts';
import { paymentMethodsFor, toMinorUnits } from './payments.ts';
import { convert, formatMoney } from './fx.ts';
import { currencyForCountry } from './currency.ts';
import { useAvatarStore } from '../store/avatar-store.ts';

const sku = (over: Partial<SkuState> = {}): SkuState => ({
  skuId: 'sku-1',
  productId: 'prod-1',
  supplierId: 'sup-1',
  stockLevel: 100,
  reorderThreshold: 10,
  reorderQuantity: 50,
  status: 'IN_STOCK',
  openPurchaseOrder: false,
  ...over,
});

// --- inventory -------------------------------------------------------------

test('deriveStatus honours the threshold boundary', () => {
  assert.equal(deriveStatus({ stockLevel: 11, reorderThreshold: 10 }), 'IN_STOCK');
  assert.equal(deriveStatus({ stockLevel: 10, reorderThreshold: 10 }), 'LOW');
  assert.equal(deriveStatus({ stockLevel: 1, reorderThreshold: 10 }), 'LOW');
  assert.equal(deriveStatus({ stockLevel: 0, reorderThreshold: 10 }), 'OUT_OF_STOCK');
});

test('healthy stock does not reorder', () => {
  const d = evaluateReorder(sku());
  assert.equal(d.shouldReorder, false);
  assert.equal(d.trigger, null);
});

test('crossing the threshold triggers a replenishment order', () => {
  const d = evaluateReorder(sku({ stockLevel: 8 }));
  assert.equal(d.shouldReorder, true);
  assert.equal(d.trigger, 'THRESHOLD_BREACH');
  assert.equal(d.units, Math.max(50, targetStockLevel(sku({ stockLevel: 8 })) - 8));
  assert.equal(d.targetLevel, 60);
});

test('sell-out triggers an immediate order', () => {
  const d = evaluateReorder(sku({ stockLevel: 0 }));
  assert.equal(d.trigger, 'SELL_OUT');
  assert.ok(d.units >= 50);
});

test('an in-flight purchase order suppresses a duplicate dispatch', () => {
  const d = evaluateReorder(sku({ stockLevel: 2, openPurchaseOrder: true }));
  assert.equal(d.shouldReorder, false, 'must not double-order during a Diwali spike');
  assert.match(d.reason, /already in flight/);
});

test('a manual request overrides the in-flight guard but still needs a supplier', () => {
  const withPO = evaluateReorder(sku({ stockLevel: 2, openPurchaseOrder: true }), true);
  assert.equal(withPO.shouldReorder, true);
  assert.equal(withPO.trigger, 'MANUAL');

  const noSupplier = evaluateReorder(sku({ stockLevel: 0, supplierId: null }), true);
  assert.equal(noSupplier.shouldReorder, false, 'never dispatch a PO with nowhere to send it');
});

test('applyMovement decrements and clamps at zero', () => {
  const r = applyMovement(sku({ stockLevel: 3 }), { skuId: 'sku-1', delta: -5, channel: 'online', reason: 'test' });
  assert.equal(r.now, 0, 'a double-submit must not drive stock negative');
  assert.equal(r.status, 'OUT_OF_STOCK');
  assert.equal(r.crossedThreshold, true, 'selling out must trigger a reorder');
});

test('applyMovement reports the threshold crossing exactly once', () => {
  const before = applyMovement(sku({ stockLevel: 12 }), { skuId: 's', delta: -1, channel: 'online', reason: '' });
  assert.equal(before.crossedThreshold, false, '12 -> 11 is still healthy');
  const at = applyMovement(sku({ stockLevel: 11 }), { skuId: 's', delta: -1, channel: 'online', reason: '' });
  assert.equal(at.crossedThreshold, true, '11 -> 10 crosses into LOW');
  const already = applyMovement(sku({ stockLevel: 10 }), { skuId: 's', delta: -1, channel: 'online', reason: '' });
  assert.equal(already.crossedThreshold, false, 'staying LOW must not re-fire');
});

test('goods receipt increases stock and clears LOW', () => {
  const r = applyMovement(sku({ stockLevel: 4 }), { skuId: 's', delta: 100, channel: 'retail', reason: 'PO received' });
  assert.equal(r.now, 104);
  assert.equal(r.status, 'IN_STOCK');
});

test('purchase order references are unique per year', () => {
  const a = nextPurchaseOrderReference(new Date('2026-01-01'));
  const b = nextPurchaseOrderReference(new Date('2026-01-01'));
  assert.notEqual(a, b);
  assert.match(a, /^PO-2026-\d{4}$/);
});

// --- sizing ----------------------------------------------------------------

const body = (over: Partial<BodyParams> = {}): BodyParams => ({ ...defaultBody('FEMALE'), ...over });

test('a standard M body recommends M', () => {
  assert.equal(recommendSize(body({ heightCm: 170, weightKg: 65, waistCm: 71, hipCm: 98, bustCm: 91 })).recommended, 'M');
});

test('size recommendation increases monotonically with body size', () => {
  // The real invariant: a bigger body never gets a smaller garment. Asserting
  // a specific label instead would just encode one arbitrary body shape.
  const ladder = [58, 64, 70, 76, 82, 89]; // waist in cm, XS -> XXL
  let previousIndex = -1;
  for (const waist of ladder) {
    const rec = recommendSize(body({ heightCm: 170, weightKg: 65, waistCm: waist, hipCm: waist + 24, bustCm: waist + 20 }));
    const index = SIZE_ORDER.indexOf(rec.recommended as never);
    assert.ok(index >= 0, `waist ${waist} produced an unranked size: ${rec.recommended}`);
    assert.ok(index > previousIndex, `waist ${waist} recommended ${rec.recommended}, not larger than the previous body`);
    previousIndex = index;
  }
  assert.equal(previousIndex, SIZE_ORDER.length - 1, 'the largest body should land on the largest block');
});

test('out-of-range measurements fall back to Custom', () => {
  const r = recommendSize(body({ heightCm: 200, weightKg: 140, waistCm: 140, hipCm: 150, bustCm: 145 }));
  assert.equal(r.recommended, 'Custom');
  assert.ok(r.notes.length > 0);
});

test('recommendation is ordered and every label is ranked', () => {
  const r = recommendSize(body());
  assert.equal(r.ranked.length, 6);
  assert.equal(r.ranked[0], r.recommended);
  assert.ok(r.fitScore >= 0);
});

test('gender helpers classify age groups correctly', () => {
  assert.ok(isKid('KID_BOY') && isKid('KID_GIRL'));
  assert.ok(!isKid('MALE') && !isKid('FEMALE'));
  assert.ok(isMens('MALE') && isMens('KID_BOY'));
  assert.ok(!isMens('FEMALE'));
});

test('kids use the child block', () => {
  const kid = defaultBody('KID_GIRL');
  assert.equal(recommendSize(kid).ranked.length, 6);
  assert.ok(bmi(kid) > 0);
});

test('a default kid body is NOT flagged as Custom', () => {
  // Regression: defaultBody once assigned adult girths to a child, which threw
  // every child shopper into the "Custom" branch on first load.
  const rec = recommendSize(defaultBody('KID_GIRL'));
  assert.notEqual(rec.recommended, 'Custom', 'a default child avatar must resolve to a real size');
  assert.notEqual(recommendSize(defaultBody('KID_BOY')).recommended, 'Custom');
});

test('every one-tap size preset recommends the size it is named after', () => {
  // Regression: the preset table drifted out of sync with the garment blocks,
  // so tapping "XL" recommended XXL. Presets are the fastest path into the
  // fitting room, so this must round-trip.
  for (const gender of ['FEMALE', 'MALE', 'KID_GIRL', 'KID_BOY'] as const) {
    for (const label of ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const) {
      useAvatarStore.getState().setGender(gender);
      useAvatarStore.getState().applySizePreset(label);
      const rec = recommendSize(useAvatarStore.getState().body);
      assert.equal(rec.recommended, label, `${gender} preset ${label} recommended ${rec.recommended}`);
    }
  }
  useAvatarStore.getState().reset();
});

// --- duties ----------------------------------------------------------------

test('EU destinations share one duty band', () => {
  assert.equal(bandForCountry('DE').country, 'EU');
  assert.equal(bandForCountry('FR').country, 'EU');
  assert.equal(bandForCountry('BR').country, 'BR');
});

test('domestic Indian orders are exempt from duty and only carry GST', () => {
  const l = calculateLandedCost(5000, 'IN');
  assert.equal(l.dutyUsd, 0);
  assert.ok(l.taxUsd > 0, 'GST still applies on a domestic sale');
  assert.equal(l.shippingUsd, 6, 'domestic shipping is far cheaper than international');
});

test('duties are waived under the de minimis threshold', () => {
  const l = calculateLandedCost(100, 'GB');
  assert.equal(l.deMinimisApplied, true);
  assert.equal(l.dutyUsd, 0);
  assert.equal(l.taxUsd, 0);
});

test('duties apply above the threshold and tax is charged on goods + duty', () => {
  const l = calculateLandedCost(1000, 'GB');
  assert.equal(l.deMinimisApplied, false);
  assert.equal(l.dutyUsd, 120); // 1000 * 12%
  assert.equal(l.taxUsd, 224); // (1000 + 120) * 20%
  assert.equal(l.totalUsd, 1000 + 120 + 224 + 20 + 4);
});

test('an unknown country falls back rather than throwing', () => {
  const l = calculateLandedCost(200, 'ZZ');
  assert.ok(l.totalUsd > 0);
  assert.equal(l.band.country, 'US');
});

// --- payments --------------------------------------------------------------

test('local wallets are offered first in their home markets', () => {
  assert.equal(paymentMethodsFor('KR')[0].provider, 'kakaopay');
  assert.equal(paymentMethodsFor('JP')[0].provider, 'paypay');
  assert.ok(paymentMethodsFor('IN').some((m) => m.provider === 'upi'));
});

test('EU countries route to the iDEAL/Klarna config', () => {
  const de = paymentMethodsFor('DE').map((m) => m.provider);
  const es = paymentMethodsFor('ES').map((m) => m.provider);
  assert.deepEqual(de, es);
  assert.ok(de.includes('ideal'));
});

test('an unknown market still gets card and PayPal', () => {
  const methods = paymentMethodsFor('ZZ').map((m) => m.provider);
  assert.ok(methods.includes('stripe'));
  assert.ok(methods.includes('paypal'));
});

test('zero-decimal currencies are not multiplied by 100', () => {
  assert.equal(toMinorUnits(29900, true), 29900, 'JPY stays in whole yen');
  assert.equal(toMinorUnits(299, false), 29900, 'USD converts to cents');
});

// --- currency --------------------------------------------------------------

test('country maps to the expected default currency', () => {
  assert.equal(currencyForCountry('KR'), 'KRW');
  assert.equal(currencyForCountry('JP'), 'JPY');
  assert.equal(currencyForCountry('GB'), 'GBP');
  assert.equal(currencyForCountry('DE'), 'EUR');
  assert.equal(currencyForCountry('ZZ'), 'USD', 'unknown falls back to the base');
  assert.equal(currencyForCountry(null), 'USD');
});

test('conversion rounds to native endings', () => {
  assert.equal(convert(189, 1361.27, 'KRW') % 100, 0, 'KRW has no minor unit');
  assert.equal(convert(189, 1, 'USD'), 189, 'USD keeps cents');
  assert.equal(convert(189, 152, 'JPY') % 100, 0, 'JPY rounds to 100s');
});

test('money formats in the right locale and symbol', () => {
  assert.match(formatMoney(189, 'USD'), /189/);
  assert.match(formatMoney(142.82, 'GBP'), /142/);
  assert.ok(!formatMoney(189, 'JPY').includes('.'), 'JPY has no decimal point');
});
