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
import { computeBoneScales, roleForBone, RIG_REST } from './rig.ts';
import { buildOrderAlertMessage, confirmationDeadline, type OrderAlertPayload } from './dispatch.ts';
import { usingInsecureSecret, SESSION_MAX_AGE_SECONDS, SESSION_STRATEGY } from './auth-config.ts';
import { RETENTION_NOTICE } from './privacy.ts';
import { scoreFit, MINIMUM_CONFIDENCE } from './fit.ts';
import { buildFittingSnapshot, isFittingSnapshot } from './fitting-snapshot.ts';
import { clampBodyParams, BODY_LIMITS } from './sizing.ts';
import { cmToIn, inchToCm, kgToLb, lbToKg, toFeetInches, formatLength } from './units.ts';

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

// --- GLB rig scaling (AvatarAsset) ----------------------------------------
// This is the maths that replaces "scale the whole mesh", so it is pinned by
// tests rather than reviewed by eye.

test('a body matching the rig rest pose produces no scaling at all', () => {
  const s = computeBoneScales({ gender: 'FEMALE', heightCm: RIG_REST.heightCm, weightKg: 62, waistCm: RIG_REST.waistCm, hipCm: RIG_REST.hipCm, bustCm: RIG_REST.girthCm });
  for (const role of ['hips', 'spine', 'chest', 'shoulder', 'arm', 'thigh'] as const) {
    for (const axis of s[role]) {
      assert.ok(Math.abs(axis - 1) < 1e-9, `${role} axis should be 1.0, got ${axis}`);
    }
  }
});

test('bone names resolve to roles, and unknown bones are ignored', () => {
  assert.equal(roleForBone('Hips'), 'hips');
  assert.equal(roleForBone('mixamorig:Spine'), 'spine');
  assert.equal(roleForBone('UpperArm_L'), 'arm');
  assert.equal(roleForBone('thigh.R'), 'thigh');
  // A rig with extra bones must not break: unrecognised names simply skip.
  assert.equal(roleForBone('index_finger_01_L'), null);
});

test('a wider bust scales the chest more in depth than in width', () => {
  // A real ribcage deepens as it widens. Uniform X/Z scaling is what makes
  // parametric avatars look like balloons.
  const wide = computeBoneScales({ gender: 'FEMALE', heightCm: 170, weightKg: 80, waistCm: 70, hipCm: 95, bustCm: 120 });
  const [x, , z] = wide.chest;
  assert.ok(x > 1, 'chest widens');
  assert.ok(z > x, 'chest must deepen more than it widens');
});

test('a wider hip scales the hips bone but barely touches the spine', () => {
  const s = computeBoneScales({ gender: 'FEMALE', heightCm: 170, weightKg: 80, waistCm: 70, hipCm: 120, bustCm: 90 });
  assert.ok(s.hips[0] > 1, 'hips widen');
  assert.ok(s.hips[2] > s.hips[0], 'hips deepen more than they widen');
  assert.ok(Math.abs(s.spine[0] - 1) < 0.01, 'a hip change must not inflate the waist');
});

test('a taller body scales limb length without widening the torso', () => {
  // Height and girth are independent inputs. Hold girth at the rig's rest value
  // so this test measures HEIGHT's effect alone — otherwise it also measures
  // whatever the chosen girth does.
  const rest = RIG_REST.girthCm;
  const tall = computeBoneScales({ gender: 'MALE', heightCm: 190, weightKg: 70, waistCm: 70, hipCm: 95, chestCm: rest });
  assert.ok(tall.arm[1] > 1, 'arms lengthen');
  assert.ok(tall.thigh[1] > 1, 'legs lengthen');
  // Width and depth are girth-driven, so height alone must not change them.
  assert.ok(Math.abs(tall.chest[0] - 1) < 1e-9, `height must not widen the chest, got ${tall.chest[0]}`);
  assert.ok(Math.abs(tall.chest[2] - 1) < 1e-9, 'height must not deepen the chest');
});

test('menswear uses chest, womenswear uses bust', () => {
  // A regression here silently swaps the measurement on every mens garment.
  const male = computeBoneScales({ gender: 'MALE', heightCm: 175, weightKg: 80, waistCm: 80, hipCm: 100, bustCm: 80, chestCm: 110 });
  const female = computeBoneScales({ gender: 'FEMALE', heightCm: 175, weightKg: 80, waistCm: 80, hipCm: 100, bustCm: 110 });
  assert.equal(male.chest[0], female.chest[0], 'a 110cm chest and a 110cm bust should scale identically');
});

test('a missing measurement never produces NaN or Infinity', () => {
  const s = computeBoneScales({ gender: 'MALE', heightCm: 175, weightKg: 80, waistCm: 80, hipCm: 100 });
  for (const role of ['hips', 'spine', 'chest', 'shoulder', 'arm', 'thigh'] as const) {
    for (const axis of s[role]) {
      assert.ok(Number.isFinite(axis), `${role} produced ${axis}`);
    }
  }
});

test('every role returns exactly three finite axes', () => {
  const s = computeBoneScales(body());
  for (const [role, axes] of Object.entries(s)) {
    assert.equal(axes.length, 3, `${role} should have 3 axes`);
    assert.ok(axes.every((a) => Number.isFinite(a) && a > 0), `${role} has an invalid axis`);
  }
});

test('bone scales are always positive, never inverted', () => {
  // A negative scale would mirror the mesh inside-out and render back-faces.
  const s = computeBoneScales({ gender: 'KID_GIRL', heightCm: 105, weightKg: 17, waistCm: 51, hipCm: 57, bustCm: 53 });
  for (const axes of Object.values(s)) {
    for (const axis of axes) assert.ok(axis > 0, `inverted axis ${axis}`);
  }
});

// --- supplier order alerts -------------------------------------------------

const alert = (over: Partial<OrderAlertPayload> = {}): OrderAlertPayload => ({
  orderReference: 'ORD-2026-AB12CD',
  supplier: {
    supplierName: 'Chanderi Weavers Collective',
    contactName: 'Sunita Bai',
    whatsappE164: '+919876543211',
    email: 'hello@chanderiweavers.in',
    city: 'Chanderi',
    state: 'Madhya Pradesh',
    leadTimeDays: 35,
  },
  lines: [
    { title: 'Chanderi Silk Saree', sku: 'chanderi-saree', size: 'M', quantity: 2, fabric: 'CHANDERI', originCity: 'Chanderi' },
    { title: 'Chanderi Silk Saree', sku: 'chanderi-saree', size: 'L', quantity: 1, fabric: 'CHANDERI', originCity: 'Chanderi' },
  ],
  destinationCountry: 'KR',
  destinationCity: 'Seoul',
  readyBy: '2026-03-12',
  ...over,
});

test('an order alert totals units across every line', () => {
  const { whatsapp } = buildOrderAlertMessage(alert());
  assert.match(whatsapp, /Total units:\* 3/, '2 + 1 must be stated as 3, not two separate counts');
});

test('an order alert carries the reply protocol the vendor portal will parse', () => {
  const { whatsapp } = buildOrderAlertMessage(alert());
  // A free-text reply is unparseable; the numeric protocol is the whole point.
  assert.match(whatsapp, /Reply 1 .* or 2 if you are out of fabric/s);
});

test('an order alert includes order ref, destination and each line', () => {
  const { whatsapp } = buildOrderAlertMessage(alert());
  assert.match(whatsapp, /ORD-2026-AB12CD/);
  assert.match(whatsapp, /Seoul, KR/);
  assert.match(whatsapp, /Size: M \| Qty: 2/);
  assert.match(whatsapp, /Size: L \| Qty: 1/);
  assert.match(whatsapp, /2026-03-12/);
});

test('an order alert names the contact person and the dispatch hub', () => {
  const { whatsapp, body } = buildOrderAlertMessage(alert());
  assert.match(whatsapp, /Namaste|Dispatch to/);
  assert.match(whatsapp, /Indian Export Hub/);
  assert.match(body, /Sunita Bai/);
});

test('an order alert is worded differently from a reorder', () => {
  // Conflating the two would tell a workshop to MAKE 30 units for an order for 1.
  const order = buildOrderAlertMessage(alert()).whatsapp;
  assert.doesNotMatch(order, /AUTOMATED SUPPLIER REORDER/);
  assert.doesNotMatch(order, /Quantity Required/);
});

test('a city-less destination still renders a valid line', () => {
  const { whatsapp } = buildOrderAlertMessage(alert({ destinationCity: null }));
  assert.match(whatsapp, /Destination:\* KR/);
  assert.doesNotMatch(whatsapp, /null/);
});

test('an empty line list does not produce NaN in the message', () => {
  const { whatsapp } = buildOrderAlertMessage(alert({ lines: [] }));
  assert.match(whatsapp, /Total units:\* 0/);
  assert.ok(!whatsapp.includes('NaN'), 'never render NaN to a supplier');
});

test('the order alert and the reorder deadline use the same rule', () => {
  // Ready-by and confirm-by must agree, or suppliers learn to ignore one of them.
  assert.equal(confirmationDeadline(35, new Date('2026-03-01')), confirmationDeadline(35, new Date('2026-03-01')));
  assert.match(confirmationDeadline(3, new Date('2026-03-01')), /2026-03-0[4-9]|2026-03-1/);
});

// --- auth config ----------------------------------------------------------

test('the dev auth secret is recognisable, and sessions are short-lived', () => {
  // The fallback is published in the repo, so it must be detectable in any
  // deployment audit rather than silently used in production.
  assert.equal(typeof usingInsecureSecret(), 'boolean');
  assert.ok(SESSION_MAX_AGE_SECONDS <= 60 * 60 * 24, 'sessions must not outlive a day');
});

test('the session strategy stays JWT', () => {
  // Regression guard. This was once configured as 'database', which parses, type
  // checks and builds cleanly — and then fails every single login at runtime
  // with UnsupportedStrategy, because Auth.js will not pair the Credentials
  // provider with database sessions.
  //
  // Nothing in the build or the type system catches that. Only this does.
  assert.equal(SESSION_STRATEGY, 'jwt', 'Credentials provider requires the JWT strategy');
});

test('the retention notice states exactly what we keep after erasure', () => {
  assert.match(RETENTION_NOTICE, /tax law/i);
  assert.match(RETENTION_NOTICE, /email and body measurements removed/i);
  // The notice is a promise. If erasure stopped scrubbing the fitting
  // snapshot, this text would be a lie — so the claim is asserted here.
  assert.match(RETENTION_NOTICE, /not the measurements/i);
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

// --- fit confidence (PDP widget) ------------------------------------------

test('a body matching its block scores at the very top of the range', () => {
  // Not exactly 100: height is folded in at quarter weight for hem length, so a
  // 170cm body in the M block still lands marginally below a 164cm one. The
  // point of the test is "near-perfect", not "exactly perfect".
  const r = scoreFit(body({ heightCm: 164, weightKg: 65, waistCm: 69, hipCm: 96, bustCm: 89 }));
  assert.equal(r.recommended, 'M');
  assert.equal(r.best.score, 100, 'height at the block midpoint with exact girths scores 100');

  const nearMiss = scoreFit(body({ heightCm: 170, weightKg: 65, waistCm: 69, hipCm: 96, bustCm: 89 }));
  assert.equal(nearMiss.recommended, 'M');
  assert.ok(nearMiss.best.score >= 95, `expected a near-perfect score, got ${nearMiss.best.score}`);
  assert.ok(nearMiss.confident);
});

test('fit scores never exceed 100 and never go negative', () => {
  for (const waist of [40, 60, 80, 100, 140, 200]) {
    const r = scoreFit(body({ waistCm: waist, hipCm: waist + 24, bustCm: waist + 20, heightCm: 170 }));
    for (const f of r.ranked) {
      assert.ok(f.score >= 0 && f.score <= 100, `score ${f.score} out of range`);
    }
  }
});

test('an implausible body is NOT reported as a confident match', () => {
  // Guards the trust failure mode: over-confident bad advice costs returns.
  const r = scoreFit(body({ heightCm: 200, weightKg: 150, waistCm: 150, hipCm: 165, bustCm: 150 }));
  if (r.best.score < MINIMUM_CONFIDENCE) {
    assert.equal(r.confident, false);
    assert.ok(r.notes.some((n) => /tailor/.test(n)), 'must offer a tailoring escape hatch');
  }
});

test('every size is scored, best first', () => {
  const r = scoreFit(body());
  assert.equal(r.ranked.length, 6);
  for (let i = 1; i < r.ranked.length; i++) {
    assert.ok(r.ranked[i - 1].score >= r.ranked[i].score, 'ranking must be descending');
  }
  assert.equal(r.ranked[0].size, r.recommended);
});

test('fit confidence rises toward the body\'s own block', () => {
  const exact = scoreFit(body({ heightCm: 170, waistCm: 69, hipCm: 96, bustCm: 89 })).best.score;
  const off = scoreFit(body({ heightCm: 170, waistCm: 80, hipCm: 107, bustCm: 100 })).best.score;
  assert.ok(exact > off, 'an on-block body must outscore a drifting one');
});

test('kids are scored against the child ladder', () => {
  const r = scoreFit({ gender: 'KID_GIRL', heightCm: 134, weightKg: 28, waistCm: 56, hipCm: 65, bustCm: 60 });
  assert.equal(r.recommended, 'M');
  assert.ok(r.confident);
});

// --- units -----------------------------------------------------------------

test('length conversions round-trip', () => {
  assert.ok(Math.abs(inchToCm(cmToIn(170)) - 170) < 1e-9);
  assert.equal(cmToIn(2.54), 1);
  assert.equal(inchToCm(1), 2.54);
});

test('weight conversions round-trip', () => {
  assert.ok(Math.abs(lbToKg(kgToLb(65)) - 65) < 1e-9);
  assert.equal(Math.round(kgToLb(45.3592)), 100);
});

test('heights render as feet and inches', () => {
  assert.deepEqual(toFeetInches(170), { feet: 5, inches: 7 });
  assert.equal(formatLength(170, 'metric'), '170 cm');
  assert.equal(formatLength(170, 'imperial'), '5′ 7″');
});

// --- fitting snapshot -----------------------------------------------------

test('the snapshot freezes the body as it was at purchase', () => {
  const body = clampBodyParams({ gender: 'FEMALE', heightCm: 165, weightKg: 58, bustCm: 88, waistCm: 70, hipCm: 96 });
  const snap = buildFittingSnapshot(body, [{ slug: 'saree', title: 'Chanderi Silk Saree', size: 'M', quantity: 1 }], new Date('2026-01-15T10:00:00Z'));

  // The shopper then edits their profile. The snapshot must not follow them.
  const later = clampBodyParams({ gender: 'FEMALE', heightCm: 165, weightKg: 74, bustCm: 99, waistCm: 84, hipCm: 106 });
  const snap2 = buildFittingSnapshot(later, [], new Date('2026-02-15T10:00:00Z'));

  assert.equal(snap.body.waistCm, 70, 'the historical snapshot keeps the original waist');
  assert.equal(snap2.body.waistCm, 84);
  assert.deepEqual(snap.items, [{ slug: 'saree', title: 'Chanderi Silk Saree', size: 'M', quantity: 1 }]);
  assert.equal(snap.capturedAt, '2026-01-15T10:00:00.000Z');
});

test('the snapshot stores measurements only, never appearance attributes', () => {
  const body = clampBodyParams({ gender: 'MALE', heightCm: 175, weightKg: 72, chestCm: 96, waistCm: 82, hipCm: 96 });
  const snap = buildFittingSnapshot(body, []);
  const keys = Object.keys(snap.body).sort();

  // skinToneHex / hairStyleId live on AvatarProfile and must NOT be copied here:
  // this column outlives the account it came from.
  assert.deepEqual(keys, ['bustCm', 'chestCm', 'gender', 'heightCm', 'hipCm', 'waistCm', 'weightKg']);
  assert.ok(!JSON.stringify(snap).toLowerCase().includes('skin'), 'no skin tone in a permanent record');
});

test('absent bust/chest are null rather than missing', () => {
  const snap = buildFittingSnapshot(
    clampBodyParams({ gender: 'MALE', heightCm: 175, weightKg: 72, waistCm: 82, hipCm: 96 }),
    [],
  );
  // A JSON column whose field is sometimes absent and sometimes null is a
  // schema nobody can query later.
  assert.equal(snap.body.bustCm, null);
  assert.ok('bustCm' in snap.body);
});

test('measurements are clamped into physiological range', () => {
  const wild = clampBodyParams({ gender: 'NONSENSE', heightCm: 9999, weightKg: -5, waistCm: 1e9, hipCm: NaN });
  assert.equal(wild.heightCm, BODY_LIMITS.heightCm[1]);
  assert.equal(wild.weightKg, BODY_LIMITS.weightKg[0]);
  assert.equal(wild.waistCm, BODY_LIMITS.girthCm[1]);
  assert.equal(wild.hipCm, 95, 'NaN falls back to a plausible default, never NaN');
  assert.equal(wild.gender, 'FEMALE', 'an unknown gender falls back rather than persisting junk');
});

test('a snapshot read back from JSON is recognisable', () => {
  const snap = buildFittingSnapshot(clampBodyParams({ gender: 'FEMALE', heightCm: 160, weightKg: 55, bustCm: 84, waistCm: 68, hipCm: 92 }), []);
  assert.ok(isFittingSnapshot(JSON.parse(JSON.stringify(snap))), 'survives a JSON round trip');
  assert.ok(!isFittingSnapshot(null));
  assert.ok(!isFittingSnapshot({ body: {} }));
  assert.ok(!isFittingSnapshot('nope'));
});

