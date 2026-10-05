import { getDb, programs } from "@misthos/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner } from "@/lib/server/owner";

const Body = z.object({
  maxSubmissionsPerRound: z.coerce.number().int().min(1).max(100),
  minXFollowers: z.coerce.number().int().min(0).max(10_000_000),
});

/** Owner: submission limits contributors see on the join page (per-round cap, minimum X followers). */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/rules">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const body = Body.safeParse(await readJson(req));
  if (!body.success)
    return jsonError("Use 1 to 100 submissions per round and 0 or more followers.", 400);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(programs).set(body.data).where(eq(programs.id, owner.program.id));
    await audit(tx, {
      programId: owner.program.id,
      actor: `user:${owner.session.sub}`,
      action: "program.rules_updated",
      entity: "program",
      entityId: owner.program.id,
      data: body.data,
    });
  });
  revalidatePath(`/app/programs/${owner.program.id}`, "layout");
  revalidatePath(`/join/${owner.program.slug}`);
  return Response.json({ ok: true });
}
