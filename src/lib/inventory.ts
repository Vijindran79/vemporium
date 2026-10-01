/**
 * Inventory + replenishment rules.
 *
 * Pure functions on purpose: the decrement/reorder decision is the one piece of
 * commerce logic that must be unit-testable without a database, a payment
 * sandbox, or a WhatsApp account. The API route wires these to Prisma and
 * Twilio; the logic itself never touches I/O.
 */

export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK' | 'IN_PRODUCTION' | 'DISPATCHED';

export interface SkuState {
  skuId: string;
  productId: string;
  supplierId: string | null;
  stockLevel: number;
  reorderThreshold: number;
  reorderQuantity: number;
  status: StockStatus;
  /** A PO already in flight for this SKU — prevents duplicate dispatches. */
  openPurchaseOrder: boolean;
}

export type ReorderTrigger = 'THRESHOLD_BREACH' | 'SELL_OUT' | 'MANUAL';

export interface ReorderDecision {
  shouldReorder: boolean;
  trigger: ReorderTrigger | null;
  reason: string;
  /** Units to order, after folding in any quantity already in production. */
  units: number;
  /** Target stock level the order aims to restore. */
  targetLevel: number;
}

export function deriveStatus(sku: Pick<SkuState, 'stockLevel' | 'reorderThreshold'>): StockStatus {
  if (sku.stockLevel <= 0) return 'OUT_OF_STOCK';
  if (sku.stockLevel <= sku.reorderThreshold) return 'LOW';
  return 'IN_STOCK';
}

/** Target level once the PO lands: threshold + one reorder batch of cover. */
export function targetStockLevel(sku: SkuState): number {
  return sku.reorderThreshold + sku.reorderQuantity;
}

/**
 * Decides whether a SKU needs replenishing after a stock movement.
 *
 * Guard: if a PO is already open we do NOT re-order. This is the guard that
 * stops a Diwali traffic spike from sending forty identical WhatsApp messages
 * to a Varanasi workshop.
 */
export function evaluateReorder(sku: SkuState, manual = false): ReorderDecision {
  const status = deriveStatus(sku);

  if (sku.supplierId == null) {
    return { shouldReorder: false, trigger: null, reason: 'No supplier linked to this SKU', units: 0, targetLevel: targetStockLevel(sku) };
  }

  if (sku.openPurchaseOrder && !manual) {
    return { shouldReorder: false, trigger: null, reason: 'A purchase order is already in flight', units: 0, targetLevel: targetStockLevel(sku) };
  }

  const target = targetStockLevel(sku);

  // A manual request is always an operator decision, so it is evaluated FIRST
  // and labelled MANUAL. Otherwise a vendor clicking "reorder" on a
  // below-threshold SKU would be told the system did it on its own, which
  // makes the audit trail lie about who initiated the purchase.
  if (manual) {
    return {
      shouldReorder: true,
      trigger: 'MANUAL',
      reason: 'Manually requested by a vendor operator',
      units: sku.stockLevel <= 0 ? Math.max(sku.reorderQuantity, target) : sku.reorderQuantity,
      targetLevel: target,
    };
  }

  if (sku.stockLevel <= 0) {
    return { shouldReorder: true, trigger: 'SELL_OUT', reason: 'Item is sold out', units: Math.max(sku.reorderQuantity, target), targetLevel: target };
  }

  if (sku.stockLevel <= sku.reorderThreshold) {
    return { shouldReorder: true, trigger: 'THRESHOLD_BREACH', reason: `Stock ${sku.stockLevel} is at or below threshold ${sku.reorderThreshold}`, units: Math.max(sku.reorderQuantity, target - sku.stockLevel), targetLevel: target };
  }

  return { shouldReorder: false, trigger: null, reason: 'Stock is healthy', units: 0, targetLevel: target };
}

export interface StockMovement {
  skuId: string;
  /** Negative deducts, positive receives (goods receipt). */
  delta: number;
  channel: 'online' | 'retail';
  reason: string;
}

export interface MovementResult {
  skuId: string;
  previous: number;
  now: number;
  status: StockStatus;
  crossedThreshold: boolean;
}

/**
 * Applies a movement. Online and retail both decrement `stockLevel` on the same
 * row, so a physical shop sale and a web sale can never oversell each other.
 * Returns a deep snapshot so the caller can dispatch on a threshold crossing.
 */
export function applyMovement(sku: SkuState, movement: StockMovement): MovementResult {
  const previous = sku.stockLevel;
  const before = deriveStatus({ stockLevel: previous, reorderThreshold: sku.reorderThreshold });
  // Never let a double-submit drive stock negative; clamp and report the drift.
  const now = Math.max(0, previous + movement.delta);
  const after = deriveStatus({ stockLevel: now, reorderThreshold: sku.reorderThreshold });

  const crossedThreshold = before !== 'LOW' && after === 'LOW';
  const soldOut = before !== 'OUT_OF_STOCK' && after === 'OUT_OF_STOCK';

  return {
    skuId: sku.skuId,
    previous,
    now,
    status: after,
    crossedThreshold: crossedThreshold || soldOut,
  };
}

let sequence = 0;
/** Human-friendly PO reference, e.g. PO-2026-0042. */
export function nextPurchaseOrderReference(now = new Date()): string {
  sequence = (sequence + 1) % 10000;
  return `PO-${now.getUTCFullYear()}-${String(sequence).padStart(4, '0')}`;
}
