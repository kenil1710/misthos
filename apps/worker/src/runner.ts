import type { RoundDeps } from "@misthos/agent";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { createQueues, runDrain, type JobOptions } from "./jobs";

/** Why a drain ran: the periodic tick, a wake call from the web app, a scheduled retry, or startup. */
export type DrainReason = "tick" | "wake" | "retry" | "startup";

export interface RunnerHealth {
  startedAt: string;
  lastDrainAt: string | null;
  lastDrainOk: boolean | null;
  lastError: string | null;
  lastTickAt: string | null;
  /** A job due now that a finished drain left queued (should not happen; means the worker is falling behind). */
  oldestQueuedAt: string | null;
  draining: boolean;
  tickMinutes: number;
}

/**
 * Runs the queues in short drains instead of polling, so the database can sleep between them (Neon scales to zero
 * after 5 idle minutes). Each drain opens pg-boss, does everything that's due, then stops it and closes the
 * connection. Only one drain runs at a time; a wake during a drain triggers one more drain right after it.
 */
export function createRunner(o: {
  makeBoss: () => PgBoss;
  deps: RoundDeps;
  log: Logger;
  opts: JobOptions;
  tickMinutes: number;
}) {
  let running: Promise<void> | null = null;
  let again = false;
  let queuesReady = false;
  let retryTimer: NodeJS.Timeout | null = null;
  let tickTimer: NodeJS.Timeout | null = null;
  const health: RunnerHealth = {
    startedAt: new Date().toISOString(),
    lastDrainAt: null,
    lastDrainOk: null,
    lastError: null,
    lastTickAt: null,
    oldestQueuedAt: null,
    draining: false,
    tickMinutes: o.tickMinutes,
  };

  const once = async (reason: DrainReason) => {
    const started = Date.now();
    const boss = o.makeBoss();
    boss.on("error", (e) => o.log.error({ err: e.message }, "pg-boss error"));
    try {
      await boss.start();
      if (!queuesReady) {
        await createQueues(boss, o.opts);
        queuesReady = true;
      }
      // Expire jobs a crashed worker left "active" so they retry, and prune old ones (pg-boss maintenance).
      if (reason !== "wake") await boss.supervise().catch(() => undefined);
      const res = await runDrain(boss, o.deps, o.log, o.opts);
      health.lastDrainOk = true;
      health.lastError = null;
      health.oldestQueuedAt = res.oldestQueuedAt?.toISOString() ?? null;
      if (reason === "tick" || reason === "startup") health.lastTickAt = new Date().toISOString();
      if (res.processed || reason !== "tick")
        o.log.info({ reason, processed: res.processed, ms: Date.now() - started }, "drain done");
      // A retry due before the next tick gets its own wake-up (backoff is seconds to minutes).
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (res.nextDueAt) {
        const wait = Math.max(1000, res.nextDueAt.getTime() - Date.now() + 500);
        if (wait < o.tickMinutes * 60_000) retryTimer = setTimeout(() => void drain("retry"), wait);
      }
    } catch (e) {
      health.lastDrainOk = false;
      health.lastError = (e as Error).message.slice(0, 300);
      o.log.error({ reason, err: (e as Error).message }, "drain failed");
    } finally {
      health.lastDrainAt = new Date().toISOString();
      await boss.stop({ graceful: true, timeout: 30_000 }).catch(() => undefined);
    }
  };

  const drain = (reason: DrainReason): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    health.draining = true;
    running = (async () => {
      let r = reason;
      do {
        again = false;
        await once(r);
        r = "wake";
      } while (again);
    })().finally(() => {
      running = null;
      health.draining = false;
    });
    return running;
  };

  return {
    drain,
    health: () => ({ ...health }),
    start() {
      void drain("startup");
      tickTimer = setInterval(() => void drain("tick"), o.tickMinutes * 60_000);
    },
    async stop() {
      if (tickTimer) clearInterval(tickTimer);
      if (retryTimer) clearTimeout(retryTimer);
      await running;
    },
  };
}

/** Healthy when the last scheduled pass ran recently and worked, and nothing due is left waiting. */
export function runnerIsHealthy(h: RunnerHealth, now = Date.now()) {
  const tickMs = h.tickMinutes * 60_000;
  const lastTick = h.lastTickAt ? Date.parse(h.lastTickAt) : Date.parse(h.startedAt);
  const problem =
    now - lastTick > 2 * tickMs + 5 * 60_000
      ? `No scheduled pass for ${Math.round((now - lastTick) / 60_000)} minutes.`
      : h.lastDrainOk === false
        ? `The last pass failed: ${h.lastError ?? "unknown error"}`
        : h.oldestQueuedAt && now - Date.parse(h.oldestQueuedAt) > 10 * 60_000 && !h.draining
          ? "Work is waiting in the queue that the last pass didn't finish."
          : null;
  return { ok: !problem, problem };
}
