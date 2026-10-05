import "server-only";
import { normalizeDatabaseUrl } from "@misthos/db";
import { PRODUCER_OPTIONS } from "@misthos/shared";
import { PgBoss } from "pg-boss";
import { env } from "./env";

const g = globalThis as unknown as { __misthosBoss?: Promise<PgBoss> };

/**
 * Producer-only pg-boss: no maintenance, scheduling or migrations here (the worker owns the schema and queues).
 */
function boss(): Promise<PgBoss> {
  g.__misthosBoss ??= (async () => {
    const b = new PgBoss({
      ...PRODUCER_OPTIONS,
      connectionString: normalizeDatabaseUrl(env().DATABASE_URL),
      max: 2,
      // A suspended Neon compute can take a few seconds to wake; don't treat that as a failure.
      connectionTimeoutMillis: 10_000,
    });
    b.on("error", (e) => console.error("pg-boss producer error", e.message));
    await b.start();
    return b;
  })().catch((e) => {
    g.__misthosBoss = undefined;
    throw e;
  });
  return g.__misthosBoss;
}

/**
 * Enqueue. "duplicate" means a job with the same key is already waiting (pg-boss deduped it), which is fine.
 * Never throws: on "failed" the row stays pending and the worker's sweeper/scheduler picks it up.
 */
export async function enqueue(
  queue: string,
  data: object,
  singletonKey: string,
): Promise<"queued" | "duplicate" | "failed"> {
  // One retry on a dropped or timed-out connection (seen live: Neon timing out a single send).
  for (let attempt = 1; ; attempt++) {
    try {
      const sent = await (await boss()).send(queue, data, { singletonKey });
      if (sent !== null) await wakeWorker();
      return sent === null ? "duplicate" : "queued";
    } catch (e) {
      const msg = (e as Error).message;
      if (attempt < 2 && /connection|timeout|terminated|ECONNRESET/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }
      console.error("enqueue failed", queue, msg);
      return "failed";
    }
  }
}

/**
 * Tell the worker there's new work so it drains now rather than on its next tick (it doesn't poll, so the database
 * can sleep). Best effort, short timeout: if the worker misses it, its periodic pass picks the job up.
 */
export async function wakeWorker(): Promise<boolean> {
  const { WORKER_URL, WORKER_WAKE_SECRET } = env();
  if (!WORKER_URL || !WORKER_WAKE_SECRET) return false;
  try {
    const res = await fetch(new URL("/wake", WORKER_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${WORKER_WAKE_SECRET}` },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
      // Never follow a redirect with the secret attached.
      redirect: "error",
    });
    return res.ok;
  } catch (e) {
    console.error("worker wake failed", (e as Error).message);
    return false;
  }
}
