import { getDb, type DbLike } from "@misthos/db";
import { ContextSaveInput } from "@misthos/shared";
import { revalidatePath } from "next/cache";
import { saveContext } from "@/lib/server/context";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner } from "@/lib/server/owner";

/** Owner: save the program's context for the agent as a new version (decisions record which one they used). */
export async function PUT(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/context">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const body = ContextSaveInput.safeParse(await readJson(req));
  if (!body.success)
    return jsonError(body.error.issues[0]?.message ?? "Check the description and links.", 400);
  const res = await (getDb() as unknown as DbLike).transaction((tx) =>
    saveContext(tx, {
      programId: owner.program.id,
      ownerUserId: owner.session.sub,
      input: body.data,
    }),
  );
  revalidatePath(`/app/programs/${owner.program.id}`, "layout");
  revalidatePath(`/join/${owner.program.slug}`);
  return Response.json({ ok: true, ...res });
}
