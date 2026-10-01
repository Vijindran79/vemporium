/**
 * Supplier dispatch — WhatsApp (Twilio) + Email.
 *
 * Every send is best-effort and never throws: a failed WhatsApp message must
 * not roll back the order that triggered it. Failures are returned so the PO
 * stays in DRAFT and a retry/sweep job can pick it up.
 *
 * In dev (no credentials) the dispatcher returns `simulated: true` and logs the
 * exact message it would have sent, so the whole flow is demoable end to end.
 */

import type { ReorderDecision } from './inventory';

export interface DispatchLine {
  skuId: string;
  title: string;
  sizeLabel: string;
  colourHex?: string | null;
  units: number;
  fabric: string;
  weave: string;
  workType: string;
  originCity?: string | null;
}

export interface DispatchTarget {
  supplierName: string;
  contactName?: string | null;
  whatsappE164: string;
  email?: string | null;
  city: string;
  state: string;
  leadTimeDays: number;
}

export interface DispatchResult {
  channel: 'whatsapp' | 'email';
  ok: boolean;
  simulated: boolean;
  detail: string;
}

export interface DispatchPayload {
  reference: string;
  supplier: DispatchTarget;
  lines: DispatchLine[];
  decision: ReorderDecision;
  /** ISO date by which the supplier must confirm/respond. */
  deadline: string;
}

function buildMessage(p: DispatchPayload): string {
  const d = p.decision;
  const header = `Namaste ${p.supplier.contactName ?? p.supplier.supplierName ?? 'team'},\n\nNew purchase order *${p.reference}* from Vemporium.\n`;

  const items = p.lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.title}\n   SKU: ${l.skuId}\n   Size: ${l.sizeLabel}${l.colourHex ? ` | Colour: ${l.colourHex}` : ''}\n   Qty: ${l.units}\n   Fabric: ${l.fabric}, ${l.weave}, ${l.workType}${l.originCity ? ` (${l.originCity})` : ''}`,
    )
    .join('\n\n');

  return `${header}*Reason:* ${d.reason} (${d.trigger ?? 'MANUAL'})\n\n${items}\n\n*Total units:* ${p.lines.reduce((a, l) => a + l.units, 0)}\n*Please confirm by:* ${p.deadline}\n*Standard lead time:* ${p.supplier.leadTimeDays} days\n\nThank you,\nVemporium Sourcing`;
}

function buildEmail(p: DispatchPayload): { subject: string; body: string } {
  const subject = `[Vemporium] Purchase Order ${p.reference} — ${p.supplier.supplierName}`;
  const rows = p.lines
    .map(
      (l) =>
        `<tr><td>${l.title}</td><td>${l.skuId}</td><td>${l.sizeLabel}</td><td>${l.units}</td><td>${l.fabric} / ${l.weave} / ${l.workType}</td></tr>`,
    )
    .join('');
  const body = `
    <p>Namaste ${p.supplier.contactName ?? 'team'},</p>
    <p>Please find purchase order <strong>${p.reference}</strong> from Vemporium.</p>
    <p><strong>Trigger:</strong> ${p.decision.trigger} — ${p.decision.reason}</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Item</th><th>SKU</th><th>Size</th><th>Qty</th><th>Spec</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><strong>Confirm by:</strong> ${p.deadline} &middot; <strong>Lead time:</strong> ${p.supplier.leadTimeDays} days</p>
    <p>— Vemporium Sourcing</p>`;
  return { subject, body };
}

async function sendWhatsApp(to: string, body: string): Promise<DispatchResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    console.info('[dispatch:simulated:whatsapp] to=%s\n%s', to, body);
    return { channel: 'whatsapp', ok: true, simulated: true, detail: 'Twilio credentials absent — message logged instead' };
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: `whatsapp:${to}`, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { sid?: string };
    return { channel: 'whatsapp', ok: true, simulated: false, detail: data.sid ?? 'sent' };
  } catch (err) {
    return { channel: 'whatsapp', ok: false, simulated: false, detail: (err as Error).message };
  }
}

async function sendEmail(to: string, subject: string, body: string): Promise<DispatchResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.DISPATCH_FROM_EMAIL;
  if (!key || !from) {
    console.info('[dispatch:simulated:email] to=%s subject=%s', to, subject);
    return { channel: 'email', ok: true, simulated: true, detail: 'Resend key absent — email logged instead' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: body }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { id?: string };
    return { channel: 'email', ok: true, simulated: false, detail: data.id ?? 'sent' };
  } catch (err) {
    return { channel: 'email', ok: false, simulated: false, detail: (err as Error).message };
  }
}

/** Fans out over every configured channel, WhatsApp first. */
export async function dispatchPurchaseOrder(p: DispatchPayload): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [await sendWhatsApp(p.supplier.whatsappE164, buildMessage(p))];
  if (p.supplier.email) {
    const { subject, body } = buildEmail(p);
    results.push(await sendEmail(p.supplier.email, subject, body));
  }
  return results;
}

/** Confirmation deadline = a third of lead time, floored at 3 days. */
export function confirmationDeadline(leadTimeDays: number, now = new Date()): string {
  const days = Math.max(3, Math.round(leadTimeDays / 3));
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
