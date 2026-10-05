import { getDb } from "@misthos/db";
import { sql } from "drizzle-orm";
import { allow, clientKey } from "@/lib/server/rate-limit";
import { workerHealth } from "@/lib/worker-health";

export const dynamic = "force-dynamic";

/**
 * For uptime monitors: 200 when the database answers and the worker is alive and keeping up, 503 otherwise (with
 * the reason). Read-only, two small queries; nothing private in the response.
 */
export async function GET(req: Request) {
  if (!allow(`health:${clientKey(req)}`, 30, 60_000))
    return Response.json({ ok: false, problem: "rate_limited" }, { status: 429 });
  const headers = { "Cache-Control": "no-store" };
  try {
    const db = getDb();
    const beat = await db.execute(
      sql`select (extract(epoch from greatest(cron_on, flow_on, bam_on)) * 1000)::float8 as beat from pgboss.version limit 1`,
    );
    const queued = await db.execute(
      sql`select (extract(epoch from min(created_on)) * 1000)::float8 as oldest from pgboss.job where name = 'submission-process' and state in ('created', 'retry') and start_after <= now()`,
    );
    const row = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
    // Epoch milliseconds from SQL: Postgres timestamp strings ("…+00") don't parse reliably as JS dates.
    const asDate = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v)));
    const h = workerHealth(asDate(row(beat)?.beat), asDate(row(queued)?.oldest));
    return Response.json(h, { status: h.ok ? 200 : 503, headers });
  } catch {
    return Response.json(
      { ok: false, problem: "The database didn't answer." },
      { status: 503, headers },
    );
  }
}
