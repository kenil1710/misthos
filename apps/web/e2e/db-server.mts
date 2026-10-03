/**
 * Throwaway Postgres for browser e2e: in-memory PGlite with every checked-in migration applied, served over the
 * Postgres wire protocol so the real app (pg driver) can use it. Nothing touches Neon.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";

export const E2E_DB_PORT = Number(process.env.E2E_DB_PORT ?? 54329);

const db = await PGlite.create({ extensions: { pg_trgm } });
await migrate(drizzle(db), {
  migrationsFolder: path.resolve(import.meta.dirname, "../../../packages/db/migrations"),
});
// Two connections: the app (pool of 1) and the test's verification queries.
const server = new PGLiteSocketServer({
  db,
  port: E2E_DB_PORT,
  host: "127.0.0.1",
  maxConnections: 2,
});
await server.start();
console.log(`e2e db ready on 127.0.0.1:${E2E_DB_PORT}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
