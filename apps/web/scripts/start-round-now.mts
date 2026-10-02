/**
 * Support tool: start a program's scheduled round now, through the same audited function as Settings → Round
 * schedule. Usage: pnpm --filter @misthos/web exec tsx --conditions=react-server scripts/start-round-now.mts <slug> "<reason>"
 */
import nextEnv from "@next/env";
import path from "node:path";

nextEnv.loadEnvConfig(path.resolve(import.meta.dirname, "../../.."));
const { getDb, programs } = await import("@misthos/db");
const { eq } = await import("drizzle-orm");
const { startRoundNow } = await import("../src/lib/server/schedule");

const [slug, reason] = process.argv.slice(2);
if (!slug || !reason) throw new Error('usage: start-round-now.mts <slug> "<reason>"');
const db = getDb();
const [p] = await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, slug));
if (!p) throw new Error(`no program ${slug}`);
const res = await startRoundNow(db as never, { programId: p.id, actor: "support:misthos", reason });
console.log(JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
