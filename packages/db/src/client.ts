import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * pg currently treats sslmode=require as verify-full (full cert + hostname check). Make that explicit so it
 * stays true when pg v9 switches `require` to libpq's weaker semantics.
 */
export function normalizeDatabaseUrl(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full");
}

/** Errors that happen while opening a connection and are worth one more try (serverless Postgres waking up). */
export function isTransientConnectError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? "";
  return (
    [
      "08P01",
      "08006",
      "08001",
      "57P03",
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EAI_AGAIN",
    ].includes(code) ||
    /authentication timed out|connection terminated|timeout exceeded when trying to connect/i.test(
      err?.message ?? "",
    )
  );
}

type Connectable = { connect: (...args: never[]) => unknown };

/**
 * Retry opening a connection when it fails transiently (Neon's "Authentication timed out" while compute wakes up).
 * Only the connect step is retried, before any query runs, so it's always safe. Supports pg-pool's callback and
 * promise forms, since `pool.query` uses the callback one internally.
 */
export function withConnectRetry<P extends Connectable>(
  pool: P,
  opts: { attempts?: number; delaysMs?: number[] } = {},
): P {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [200, 600];
  const original = (pool.connect as unknown as () => Promise<{ release: () => void }>).bind(pool);
  const connectWithRetry = async () => {
    for (let i = 1; ; i++) {
      try {
        return await original();
      } catch (e) {
        if (i >= attempts || !isTransientConnectError(e)) throw e;
        await new Promise((r) => setTimeout(r, delays[Math.min(i - 1, delays.length - 1)]));
      }
    }
  };
  (pool as unknown as { connect: unknown }).connect = (
    cb?: (err: unknown, client?: unknown, done?: (e?: unknown) => void) => void,
  ) => {
    const p = connectWithRetry();
    if (!cb) return p;
    p.then(
      (client) =>
        cb(undefined, client, (e?: unknown) => (client.release as (e?: unknown) => void)(e)),
      (err) => cb(err, undefined, () => {}),
    );
    return undefined;
  };
  return pool;
}

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const max = opts.max ?? (Number(process.env.DB_POOL_MAX) || 5);
  const pool = withConnectRetry(new pg.Pool({ connectionString: normalizeDatabaseUrl(url), max }));
  // Serverless Postgres closes idle connections; pg reports that as an 'error' on the pool. Without a listener
  // Node treats it as an uncaught exception and the process exits. The pool drops the dead client and reconnects
  // on the next query, so logging is all that's needed.
  pool.on("error", (err) => {
    console.warn(`[db] idle connection closed: ${(err as { code?: string }).code ?? err.message}`);
  });
  return { db: drizzle(pool, { schema }), pool };
}

const globalForDb = globalThis as unknown as { __misthosDb?: Db };

/** Process-wide singleton (survives Next.js dev hot reloads). Reads DATABASE_URL lazily. */
export function getDb(): Db {
  if (!globalForDb.__misthosDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__misthosDb = createDb(url).db;
  }
  return globalForDb.__misthosDb;
}

/** Any Drizzle Postgres database or transaction over this schema (node-postgres in the app, PGlite in tests). */
export type DbLike = PgDatabase<PgQueryResultHKT, typeof schema>;
