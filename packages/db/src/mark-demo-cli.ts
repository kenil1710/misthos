import { createDb } from "./client";
import { markProgramsDemoSince } from "./mark-demo";

/**
 * pnpm --filter @misthos/db mark-demo            → programs created since local midnight today
 * pnpm --filter @misthos/db mark-demo 2026-10-02 → since local midnight on that date
 */
const arg = process.argv[2];
const since = arg ? new Date(`${arg}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
if (Number.isNaN(since.getTime())) throw new Error(`Invalid date: ${arg}`);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url, { max: 1 });
const marked = await markProgramsDemoSince(db, since);
console.log(
  marked.length
    ? marked.map((p) => `marked demo: ${p.slug} (created ${p.createdAt.toISOString()})`).join("\n")
    : `no unflagged programs created since ${since.toString()}`,
);
await pool.end();
