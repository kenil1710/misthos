/** What the worker's /health returns (see apps/worker/src/runner.ts). */
interface WorkerReport {
  ok?: unknown;
  problem?: unknown;
  lastTickAt?: unknown;
  lastDrainAt?: unknown;
  tickMinutes?: unknown;
}

export interface WorkerHealth {
  ok: boolean;
  /** Why it isn't ok, in words for whoever gets the alert. */
  problem: string | null;
  lastTickAt: string | null;
  lastDrainAt: string | null;
  tickMinutes: number | null;
}

/** Normalize the worker's own report; no answer (down, crashed, unreachable) is unhealthy. */
export function workerHealth(report: unknown): WorkerHealth {
  if (!report || typeof report !== "object")
    return {
      ok: false,
      problem: "The worker didn't answer.",
      lastTickAt: null,
      lastDrainAt: null,
      tickMinutes: null,
    };
  const r = report as WorkerReport;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const ok = r.ok === true;
  return {
    ok,
    problem: ok ? null : (str(r.problem) ?? "The worker reported a problem."),
    lastTickAt: str(r.lastTickAt),
    lastDrainAt: str(r.lastDrainAt),
    tickMinutes: typeof r.tickMinutes === "number" ? r.tickMinutes : null,
  };
}
