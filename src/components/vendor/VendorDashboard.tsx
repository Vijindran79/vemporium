'use client';

/**
 * Vendor restock dashboard (Screen 5).
 *
 * Operator's view of the automated dispatch engine: pick a SKU, see the
 * replenishment decision, and preview the exact WhatsApp payload that would go
 * to the workshop.
 *
 * The decision logic is the SAME evaluateReorder() the webhook uses, so what
 * an operator sees here is what the system will actually do — not a
 * re-implementation that can drift.
 */

import { useMemo, useState } from 'react';
import { evaluateReorder, applyMovement, deriveStatus, nextPurchaseOrderReference, type SkuState } from '@/lib/inventory';
import { confirmationDeadline, type DispatchLine } from '@/lib/dispatch';

interface SimSku extends SkuState {
  label: string;
  fabric: string;
  weave: string;
  workType: string;
  originCity: string;
  colourHex: string;
  supplierName: string;
  supplierCity: string;
  supplierState: string;
  supplierPhone: string;
  leadTimeDays: number;
}

const SEED: SimSku[] = [
  {
    skuId: 'CHN-GRN-M',
    label: 'Chanderi Silk Saree (Green)',
    fabric: 'CHANDERI',
    weave: 'HANDLOOM',
    workType: 'PLAIN',
    originCity: 'Chanderi',
    colourHex: '#4A6B8A',
    supplierName: 'Chanderi Weavers Collective',
    supplierCity: 'Chanderi',
    supplierState: 'Madhya Pradesh',
    supplierPhone: '+919876543211',
    leadTimeDays: 35,
    productId: 'p-chanderi-saree',
    supplierId: 'sup-chanderi',
    stockLevel: 3,
    reorderThreshold: 4,
    reorderQuantity: 30,
    status: 'LOW',
    openPurchaseOrder: false,
  },
  {
    skuId: 'BAN-MAR-L',
    label: 'Banarasi Silk Saree (Maroon)',
    fabric: 'BANARASI_BROCATTE',
    weave: 'HANDLOOM',
    workType: 'ZARI',
    originCity: 'Varanasi',
    colourHex: '#7B1E3A',
    supplierName: 'Varanasi Zari Works',
    supplierCity: 'Varanasi',
    supplierState: 'Uttar Pradesh',
    supplierPhone: '+919876543210',
    leadTimeDays: 28,
    productId: 'p-banarasi-saree',
    supplierId: 'sup-varanasi',
    stockLevel: 41,
    reorderThreshold: 6,
    reorderQuantity: 25,
    status: 'IN_STOCK',
    openPurchaseOrder: false,
  },
  {
    skuId: 'SHW-PUR-M',
    label: 'Zari Sherwani (Purple)',
    fabric: 'SILK',
    weave: 'JACQUARD',
    workType: 'ZARI',
    originCity: 'Lucknow',
    colourHex: '#2E1A3B',
    supplierName: 'Varanasi Zari Works',
    supplierCity: 'Varanasi',
    supplierState: 'Uttar Pradesh',
    supplierPhone: '+919876543210',
    leadTimeDays: 28,
    productId: 'p-sherwani',
    supplierId: 'sup-varanasi',
    stockLevel: 0,
    reorderThreshold: 3,
    reorderQuantity: 20,
    status: 'OUT_OF_STOCK',
    openPurchaseOrder: false,
  },
];

export function VendorDashboard() {
  const [skus, setSkus] = useState(SEED);
  const [selectedId, setSelectedId] = useState(SEED[0].skuId);
  const [inFlight, setInFlight] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);

  const sku = skus.find((s) => s.skuId === selectedId)!;
  const decision = useMemo(
    () => evaluateReorder({ ...sku, openPurchaseOrder: !!inFlight[sku.skuId] }),
    [sku, inFlight],
  );
  const reference = useMemo(() => nextPurchaseOrderReference(), [sku.skuId, decision.units]);

  function simulateSale() {
    const movement = applyMovement(sku, { skuId: sku.skuId, delta: -1, channel: 'online', reason: 'Demo sale' });
    setSkus((prev) => prev.map((s) => (s.skuId === sku.skuId ? { ...s, stockLevel: movement.now, status: movement.status } : s)));
    setLog((l) => [`Sale of 1 × ${sku.skuId}: ${movement.previous} → ${movement.now} (${movement.status})`, ...l].slice(0, 12));
  }

  function dispatch() {
    setInFlight((m) => ({ ...m, [sku.skuId]: reference }));
    setLog((l) => [`${reference} dispatched to ${sku.supplierName} — ${decision.units} units (simulated)`, ...l].slice(0, 12));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-4">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">PO</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const st = deriveStatus(s);
                return (
                  <tr
                    key={s.skuId}
                    onClick={() => setSelectedId(s.skuId)}
                    className={`cursor-pointer border-t border-stone-100 text-xs ${s.skuId === selectedId ? 'bg-gold/10' : 'hover:bg-stone-50'}`}
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono">{s.skuId}</span>
                      <span className="block text-[10px] text-stone-400">{s.label}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{s.stockLevel}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          st === 'OUT_OF_STOCK'
                            ? 'bg-red-100 text-red-700'
                            : st === 'LOW'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {st.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-stone-500">{inFlight[s.skuId] ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-stone-800">Simulate activity</h3>
          <p className="mt-0.5 text-[11px] text-stone-500">
            Sell units to watch the threshold rule fire — then try dispatching twice to see the in-flight PO guard
            refuse the duplicate.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={simulateSale} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
              Record a sale
            </button>
            <button
              type="button"
              onClick={dispatch}
              disabled={!decision.shouldReorder}
              className="btn-primary !px-3 !py-1.5 !text-[11px] disabled:opacity-40"
            >
              Create &amp; dispatch PO
            </button>
          </div>

          {log.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2">
              {log.map((entry, i) => (
                <li key={i} className="font-mono text-[10px] text-stone-500">{entry}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className={`card p-4 ${decision.shouldReorder ? 'border-amber-300 bg-amber-50/40' : ''}`}>
          <h3 className="text-sm font-semibold text-stone-800">Replenishment decision</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-500">Trigger</dt>
              <dd className="font-medium">{decision.trigger ?? 'NONE'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Reason</dt>
              <dd className="text-right text-xs text-stone-700">{decision.reason}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Units to order</dt>
              <dd className="font-mono font-semibold">{decision.units}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Target level</dt>
              <dd className="font-mono">{decision.targetLevel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-500">On hand</dt>
              <dd className="font-mono">{sku.stockLevel} (threshold {sku.reorderThreshold})</dd>
            </div>
          </dl>
        </div>

        {/* The exact payload, in the format the spec requires. */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2">
            <h3 className="text-sm font-semibold text-stone-800">Dispatch payload</h3>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              WhatsApp · {sku.supplierPhone}
            </span>
          </div>

          {decision.shouldReorder ? (
            <pre className="overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-stone-700">
{`[AUTOMATED SUPPLIER REORDER]
Order ID: ${reference}
Item: ${sku.label}
SKU: ${sku.skuId}
Quantity Required: ${decision.units} Units
Fabric: ${sku.fabric}, ${sku.weave}, ${sku.workType}
Workshop: ${sku.supplierName}, ${sku.supplierCity}, ${sku.supplierState}
Dispatch To: Indian Export Hub / Dispatch Center
Please reply 1 to accept or 2 to report out of fabric.
Confirm by: ${confirmationDeadline(sku.leadTimeDays)}`}
            </pre>
          ) : (
            <p className="p-6 text-center text-xs text-stone-500">
              No dispatch needed. {decision.reason}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
