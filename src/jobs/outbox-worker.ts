/**
 * Standalone outbox worker — the VPS/docker counterpart to the Vercel cron
 * route (`src/app/api/cron/process-outbox/route.ts`).
 *
 * Why two callers for one queue: Vercel Cron issues an HTTP GET every 5
 * minutes, which is the only scheduler on that platform. Anywhere a
 * long-lived process can run (VPS, docker, `npm run worker`), this loop is
 * cheaper and tighter than self-pinging an HTTP endpoint — no auth header to
 * leak, no cold start, and the interval is seconds rather than minutes, so a
 * paid order reaches its workshop while the karigah is still looking at
 * WhatsApp.
 *
 * Both callers route through processOutboxBatch(). That is the point: the
 * claim (conditional PENDING->PROCESSING update), the Twilio dispatch, the
 * exponential-backoff retry and the stale-lock reclaim (> LOCK_TIMEOUT_MS)
 * live in exactly one place, so the two schedulers cannot drift apart.
 *
 * Run with:  npm run worker
 * (see package.json — `tsx src/jobs/outbox-worker.ts`)
 */

import { deadLetterCount, processOutboxBatch, type BatchResult } from '../lib/outbox';

export interface OutboxWorkerOptions {
  /** Ms between passes. Defaults to OUTBOX_INTERVAL_MS or 30s. */
  intervalMs?: number;
  /** Rows one pass will claim. Defaults to OUTBOX_BATCH_SIZE or 25. */
  batchSize?: number;
  /** Stable identity for this process, recorded on claimed rows. */
  workerId?: string;
  /** Fires after every pass — wire to metrics/alerting. */
  onPass?: (result: BatchResult) => void;
  /** Fires when a whole pass throws — the loop continues regardless. */
  onError?: (err: unknown) => void;
}

export interface OutboxWorkerHandle {
  /** Stops the loop after the in-flight pass finishes. */
  stop: () => void;
  /** Resolves once the loop has fully stopped. */
  stopped: Promise<void>;
  /** Passes completed since start. */
  passes: () => number;
}

const DEFAULT_INTERVAL_MS = 30_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * One worker pass: reclaim orphaned locks, send every due supplier message,
 * and shout when rows exhaust their retries. Throws nothing — a failed pass
 * is logged and counted, never fatal, because a worker that exits on the
 * first Twilio 500 is a worker that stops delivering paid orders.
 */
export async function runOutboxWorkerPass(
  options: Pick<OutboxWorkerOptions, 'batchSize' | 'workerId'> = {},
): Promise<BatchResult> {
  const batch = await processOutboxBatch({
    batchSize: options.batchSize ?? envInt('OUTBOX_BATCH_SIZE', 25),
    workerId: options.workerId,
  });

  if (batch.dead > 0) {
    const total = await deadLetterCount();
    console.error(
      `[outbox-worker] ${batch.dead} message(s) exhausted retries and are now DEAD ` +
        `(${total} total). A paid order may have no supplier notification — investigate.`,
    );
  }

  return batch;
}

/**
 * Starts the loop. Overlapping passes are skipped, not queued: a slow Twilio
 * means the next tick finds the previous pass still holding its claims, and
 * running two passes concurrently would double-send the same supplier
 * message. The claim is already concurrency-safe, so a skip is purely a
 * load-shedding decision, never a correctness one.
 */
export function startOutboxWorker(options: OutboxWorkerOptions = {}): OutboxWorkerHandle {
  const intervalMs = options.intervalMs ?? envInt('OUTBOX_INTERVAL_MS', DEFAULT_INTERVAL_MS);
  const batchSize = options.batchSize ?? envInt('OUTBOX_BATCH_SIZE', 25);
  const workerId = options.workerId ?? `standalone-${process.pid}`;

  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let passCount = 0;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  async function tick(): Promise<void> {
    if (inFlight) {
      console.warn('[outbox-worker] previous pass still running — skipping this tick');
      return;
    }
    inFlight = true;
    try {
      const result = await runOutboxWorkerPass({ batchSize, workerId });
      passCount += 1;
      console.info(
        `[outbox-worker] pass #${passCount}: ` +
          `claimed=${result.claimed} sent=${result.sent} ` +
          `retried=${result.retried} dead=${result.dead} reclaimed=${result.reclaimed}`,
      );
      options.onPass?.(result);
    } catch (err) {
      console.error('[outbox-worker] pass failed — loop continues', err);
      options.onError?.(err);
    } finally {
      inFlight = false;
    }
  }

  console.info(`[outbox-worker] starting (${workerId}, every ${intervalMs}ms, batch=${batchSize})`);
  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // A worker must never hold the event loop open on its own: without this, a
  // test that starts and stops the loop still hangs at teardown.
  timer.unref?.();

  let stoppedFlag = false;
  return {
    stop() {
      if (stoppedFlag) return;
      stoppedFlag = true;
      if (timer) clearInterval(timer);
      timer = null;
      // If a pass is mid-flight, wait for it rather than abandoning claimed
      // rows — they carry our workerId and would sit in PROCESSING until the
      // lock timeout reclaims them.
      const wait = () => {
        if (!inFlight) {
          console.info(`[outbox-worker] stopped after ${passCount} pass(es)`);
          resolveStopped();
        } else {
          setTimeout(wait, 100);
        }
      };
      wait();
    },
    stopped,
    passes: () => passCount,
  };
}

// --- CLI entry -------------------------------------------------------------
// `tsx src/jobs/outbox-worker.ts` runs the loop until SIGINT/SIGTERM.
// Importing this module (tests, one-off scripts) does NOT start anything.
const invokedDirectly =
  process.argv[1]?.endsWith('outbox-worker.ts') || process.argv[1]?.endsWith('outbox-worker.js');

if (invokedDirectly) {
  const handle = startOutboxWorker();

  const shutdown = (signal: string) => {
    console.info(`[outbox-worker] received ${signal} — finishing the in-flight pass`);
    handle.stop();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  void handle.stopped.then(() => process.exit(0));
}
