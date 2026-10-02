/**
 * Dispatch outbox: delivery and retry.
 *
 * The paid transition writes INTENT (status + stock + these rows) inside the
 * transaction; this module gets the message actually delivered. Two callers:
 *
 *   - drainOutbox(orderId)      immediate, right after the payment commits
 *   - processOutboxBatch()      the retry worker, for anything still PENDING
 *
 * Both route every outcome through recordOutcome(). That is the point: two
 * implementations of "what happens after a send attempt" will drift, and drift
 * here means a paid order that silently never reaches its workshop.
 *
 * STATE MACHINE
 * -------------
 *   PENDING --claim--> PROCESSING --ok------> SENT
 *                          |
 *                          +--fail, attempts < MAX--> PENDING (nextAttemptAt = backoff)
 *                          |
 *                          +--fail, attempts = MAX--> DEAD
 *
 * PROCESSING carries lockedAt. A worker that dies mid-flight cannot release its
 * own lock, so any PROCESSING row older than LOCK_TIMEOUT_MS is reclaimed by the
 * next worker. Without that, one crash strands paid orders in PROCESSING forever
 * — the most common way a job queue silently dies.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import { dispatchOrderAlert, type OrderAlertPayload } from './dispatch';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'DEAD';

/** Give up after this many attempts and require a human. */
export const MAX_ATTEMPTS = 5;

/** A claim older than this is presumed orphaned and is reclaimed. */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** Rows one worker pass will claim. Keeps a cron invocation bounded. */
export const DEFAULT_BATCH_SIZE = 25;

const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/**
 * Exponential backoff: 1m, 2m, 4m, 8m, capped at an hour.
 *
 * Capped because these are ORDER ALERTS to a workshop, not background analytics.
 * Uncapped doubling would push the last attempt hours past the point where the
 * karigah has stopped looking at WhatsApp for the day — arithmetically correct,
 * commercially useless.
 */
export function retryDelayMs(attempts: number): number {
  // NaN propagates silently through Math.floor/Math.min, producing NaN here and
  // then an Invalid Date in nextAttemptAt — which Prisma rejects and which takes
  // the whole worker pass down. Guard the input, not just the result.
  const n = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  return Math.min(BASE_DELAY_MS * 2 ** n, MAX_DELAY_MS);
}

/** Next attempt time after `attempts` failures. Pure, so it can be tested. */
export function nextAttemptAt(attempts: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + retryDelayMs(attempts));
}
/**
 * One worker pass. Claims due rows, sends them, records the outcome.
 *
 * Safe to run concurrently: the claim is a conditional update per row, so two
 * workers racing for the same row see exactly one `count === 1`.
 */
export async function processOutboxBatch(
  options: { batchSize?: number; workerId?: string; now?: Date } = {},
): Promise<BatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const now = options.now ?? new Date();

  const result: BatchResult = { claimed: 0, sent: 0, retried: 0, dead: 0, reclaimed: 0 };

  result.reclaimed = await reclaimStaleLocks(now);

  const due = await prisma.dispatchOutbox.findMany({
    where: {
      status: 'PENDING',
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: batchSize,
    select: { id: true },
  });

  for (const row of due) {
    // The conditional update IS the claim. Without `status: 'PENDING'` in the
    // where, two workers both send the same supplier message.
    const claimed = await prisma.dispatchOutbox.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'PROCESSING', lockedAt: now, workerId, lastError: null },
    });
    if (claimed.count !== 1) continue; // another worker won this row

    result.claimed += 1;
    const full = await prisma.dispatchOutbox.findUnique({ where: { id: row.id } });
    if (!full) continue;

    const outcome = await recordOutcome(full);
    if (outcome === 'SENT') result.sent += 1;
    else if (outcome === 'DEAD') result.dead += 1;
    else result.retried += 1;
  }

  return result;
}

/**
 * Returns PROCESSING rows whose worker has clearly gone away to PENDING.
 *
 * Time-based rather than heartbeat-based on purpose: a worker cannot be relied
 * on to emit a "still alive" signal, and a row that is merely SLOW is far
 * cheaper to duplicate than an order that is never sent. Delivery is
 * at-least-once, and for a "prepare these 3 garments" message a rare duplicate
 * beats a lost order.
 */
export async function reclaimStaleLocks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOCK_TIMEOUT_MS);
  const reclaimed = await prisma.dispatchOutbox.updateMany({
    where: { status: 'PROCESSING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null, workerId: null },
  });
  return reclaimed.count;
}

/**
 * Sends one row and records what happened. The single source of truth for
 * post-send state, shared by the immediate drain and the retry worker.
 */
export async function recordOutcome(row: { id: string; payload: unknown; attempts: number }): Promise<OutboxStatus> {
  const attempts = row.attempts + 1;

  try {
    const results = await dispatchOrderAlert(row.payload as OrderAlertPayload);
    const ok = results.some((r) => r.ok);

    if (ok) {
      await prisma.dispatchOutbox.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          attempts,
          lockedAt: null,
          workerId: null,
          lastError: null,
        },
      });
      return 'SENT';
    }

    return await scheduleRetry(row.id, attempts, results.map((r) => r.detail).join('; '));
  } catch (err) {
    // dispatchOrderAlert is already non-throwing; this is belt and braces. The
    // row must survive whatever went wrong.
    return await scheduleRetry(row.id, attempts, String(err));
  }
}

async function scheduleRetry(rowId: string, attempts: number, error: string): Promise<OutboxStatus> {
  const exhausted = attempts >= MAX_ATTEMPTS;

  await prisma.dispatchOutbox.update({
    where: { id: rowId },
    data: exhausted
      ? { status: 'DEAD', attempts, lockedAt: null, workerId: null, lastError: error.slice(0, 500) }
      : {
          status: 'PENDING',
          attempts,
          nextAttemptAt: nextAttemptAt(attempts),
          lockedAt: null,
          workerId: null,
          lastError: error.slice(0, 500),
        },
  });

  return exhausted ? 'DEAD' : 'PENDING';
}

/**
 * Immediate delivery for one order, called right after the payment commits.
 *
 * Best-effort and fast: a failure here does not roll anything back, it just
 * leaves the row PENDING for the worker to pick up with backoff.
 */
export async function drainOutbox(orderId: string): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.dispatchOutbox.findMany({
    where: { orderId, status: { in: ['PENDING', 'PROCESSING'] } },
    orderBy: { createdAt: 'asc' },
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const outcome = await recordOutcome(row);
    if (outcome === 'SENT') sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}

/** Dead rows a human needs to look at. Surfaces on the vendor dashboard. */
export async function deadLetterCount(): Promise<number> {
  return prisma.dispatchOutbox.count({ where: { status: 'DEAD' } });
}

export function isTerminal(status: string): boolean {
  return status === 'SENT' || status === 'DEAD';
}

export interface BatchResult {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  reclaimed: number;
}