import { getDb, type DbLike } from "@misthos/db";
import { z } from "zod";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireProgramOwner } from "@/lib/server/owner";
import { startRoundNow, updateSchedule } from "@/lib/server/schedule";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_now") }),
  z.object({
    action: z.literal("update"),
    roundLengthDays: z.coerce.number().int().min(1).max(90),
    startsAt: z.iso.datetime().optional(),
  }),
]);

/** Owner: start the upcoming round now, or change when it starts and how long rounds last. */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/programs/[id]/schedule">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireProgramOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("Check the round length (1 to 90 days) and start time.", 400);
  const db = getDb() as unknown as DbLike;
  const actor = `user:${owner.session.sub}`;
  const res =
    body.data.action === "start_now"
      ? await startRoundNow(db, { programId: owner.program.id, actor })
      : await updateSchedule(db, {
          programId: owner.program.id,
          actor,
          roundLengthDays: body.data.roundLengthDays,
          startsAt: body.data.startsAt ? new Date(body.data.startsAt) : undefined,
        });
  if (!res.ok) return jsonError(res.error, 409);
  return Response.json({ ok: true, round: res.round });
}
