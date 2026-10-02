import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../src/schema";

export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

let template: Promise<PGlite> | undefined;

/** Migrated once per test file; each test gets a fast clone. */
function migratedTemplate(): Promise<PGlite> {
  template ??= (async () => {
    const client = await PGlite.create({ extensions: { pg_trgm } });
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    return client;
  })();
  return template;
}

/** Fresh in-process Postgres with every checked-in migration applied. */
export async function testDb(): Promise<{ db: PgliteDatabase<typeof schema>; client: PGlite }> {
  const client = (await (await migratedTemplate()).clone()) as PGlite;
  return { db: drizzle(client, { schema }), client };
}
