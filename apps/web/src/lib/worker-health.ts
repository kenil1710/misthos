/** The worker updates pg-boss's cron/flow timestamps every few seconds; the web app never does (schedule: false). */
export const WORKER_STALE_MS = 5 * 60_000;
/** A submission job still queued after this long means the worker isn't taking work. */
export const QUEUE_STUCK_MS = 10 * 60_000;

export interface WorkerHealth {
  ok: boolean;
  /** Why it isn't ok, in words for whoever gets the alert. */
  problem: string | null;
  workerSeenSecondsAgo: number | null;
  oldestQueuedSeconds: number | null;
}

/** Healthy when the worker was seen recently and nothing has been waiting in the queue for long. */
export function workerHealth(
  lastBeat: Date | null,
  oldestQueued: Date | null,
  now: number = Date.now(),
): WorkerHealth {
  const seen = lastBeat ? Math.max(0, Math.round((now - lastBeat.getTime()) / 1000)) : null;
  const queued = oldestQueued
    ? Math.max(0, Math.round((now - oldestQueued.getTime()) / 1000))
    : null;
  const problem =
    seen === null
      ? "The worker has never reported in."
      : seen * 1000 > WORKER_STALE_MS
        ? `The worker hasn't been seen for ${Math.round(seen / 60)} minutes.`
        : queued !== null && queued * 1000 > QUEUE_STUCK_MS
          ? `A submission has been waiting ${Math.round(queued / 60)} minutes for the worker.`
          : null;
  return { ok: !problem, problem, workerSeenSecondsAgo: seen, oldestQueuedSeconds: queued };
}
