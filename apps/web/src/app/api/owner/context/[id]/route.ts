import { getDb, programContexts } from "@misthos/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError } from "@/lib/server/http";
import { getOwnerSession } from "@/lib/server/session";

/** Owner: the state of a context read (reading → ready or failed), with what the agent understood. */
export async function GET(_req: Request, ctx: RouteContext<"/api/owner/context/[id]">) {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const id = (await ctx.params).id;
  if (!z.uuid().safeParse(id).success) return jsonError("not_found", 404);
  const [row] = await getDb()
    .select()
    .from(programContexts)
    .where(and(eq(programContexts.id, id), eq(programContexts.ownerUserId, session.sub)))
    .limit(1);
  if (!row) return jsonError("not_found", 404);
  return Response.json(
    {
      status: row.status,
      understanding: row.understandingJson,
      sources: row.sourcesJson,
      error: row.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
