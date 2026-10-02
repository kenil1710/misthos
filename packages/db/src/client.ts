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

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: normalizeDatabaseUrl(url), max: opts.max ?? 5 });
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
