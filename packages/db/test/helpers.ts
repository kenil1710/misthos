import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../src/schema";

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** Fresh in-process Postgres with every checked-in migration applied. */
export async function testDb(): Promise<{ db: PgliteDatabase<typeof schema>; client: PGlite }> {
  const client = await PGlite.create({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, client };
}
