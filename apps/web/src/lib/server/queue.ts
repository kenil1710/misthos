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
  try {
    return (await (await boss()).send(queue, data, { singletonKey })) === null
      ? "duplicate"
      : "queued";
  } catch (e) {
    console.error("enqueue failed", queue, (e as Error).message);
    return "failed";
  }
}
