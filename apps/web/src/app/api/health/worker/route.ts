import { env } from "@/lib/server/env";
import { allow, clientKey } from "@/lib/server/rate-limit";
import { workerHealth } from "@/lib/worker-health";

export const dynamic = "force-dynamic";

/**
 * For uptime monitors: 200 when the worker answers and its scheduled passes are running and keeping up, 503
 * otherwise (with the reason). Asks the worker's own /health, which answers from memory: checking never touches
 * the database, so monitoring doesn't keep Neon awake.
 */
export async function GET(req: Request) {
  if (!allow(`health:${clientKey(req)}`, 30, 60_000))
    return Response.json({ ok: false, problem: "rate_limited" }, { status: 429 });
  const headers = { "Cache-Control": "no-store" };
  const url = env().WORKER_URL;
  if (!url)
    return Response.json(
      { ok: false, problem: "WORKER_URL isn't configured." },
      { status: 503, headers },
    );
  const h = workerHealth(
    await fetch(new URL("/health", url), { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<unknown>)
      .catch(() => null),
  );
  return Response.json(h, { status: h.ok ? 200 : 503, headers });
}
