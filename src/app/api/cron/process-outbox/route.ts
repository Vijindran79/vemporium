/**
 * GET /api/cron/process-outbox — the dispatch retry worker.
 *
 * Invoked on a schedule (see vercel.json). Reclaims orphaned locks, then sends
 * every supplier message that is due.
 *
 * AUTHENTICATION IS NOT OPTIONAL. This endpoint causes WhatsApp messages to be
 * sent from our Twilio account. Unprotected, anyone who learns the URL can use
 * our number to message suppliers — and, worse, can drive the queue into a state
 * where real orders never get sent.
 *
 * Verified with a constant-time compare against CRON_SECRET. In production a
 * missing secret fails CLOSED (503), unlike the legacy internal webhook which
 * degrades to open in development. A worker that silently accepts everyone is
 * worse than a worker that refuses to run.
 *
 * GET, not POST: Vercel Cron issues GET.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processOutboxBatch, reclaimStaleLocks, deadLetterCount } from '@/lib/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vercel caps cron invocations; make sure ours is not cut off mid-batch. */
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const batch = await processOutboxBatch();

    // Surfaced rather than swallowed: a growing DEAD pile means paid orders whose
    // workshops were never told, and that must page somebody, not sit in a table.
    const dead = await deadLetterCount();

    if (batch.dead > 0) {
      console.error(
        `[outbox] ${batch.dead} message(s) exhausted retries and are now DEAD. ` +
          `${dead} total. A paid order may have no supplier notification — investigate.`,
      );
    }

    return NextResponse.json({ ok: true, ...batch, deadTotal: dead });
  } catch (err) {
    console.error('[outbox] worker pass failed', err);
    // 500 so the scheduler retries the pass.
    return NextResponse.json({ error: 'Outbox pass failed' }, { status: 500 });
  }
}

/**
 * POST /api/cron/process-outbox/reclaim — recover stranded rows without sending.
 *
 * Separate from the worker so that reclaiming a crashed worker's rows does NOT
 * also immediately re-send every message it was holding. An operator runs this
 * after investigating; the normal worker reclaims and sends together.
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const reclaimed = await reclaimStaleLocks();
    return NextResponse.json({ ok: true, reclaimed });
  } catch (err) {
    console.error('[outbox] reclaim failed', err);
    return NextResponse.json({ error: 'Reclaim failed' }, { status: 500 });
  }
}