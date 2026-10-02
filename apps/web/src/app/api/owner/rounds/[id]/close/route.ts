import { getDb } from "@misthos/db";
import { QUEUES } from "@misthos/shared";
import { audit } from "@/lib/server/audit";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { requireRoundOwner } from "@/lib/server/owner";
import { enqueue } from "@/lib/server/queue";

/** "Close round now": the worker closes it, re-checks, and proposes payouts. */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/rounds/[id]/close">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireRoundOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const { session, program, round } = owner;
  if (!program.vaultAddress)
    return jsonError("Deploy and fund the vault before closing a round.", 409);
  if (round.status !== "open") return jsonError("This round is already closed.", 409);
  const ok = await enqueue(
    QUEUES.runRound,
    { roundId: round.id, force: true },
    `round:${round.id}`,
  );
  if (ok === "failed") return jsonError("Couldn't queue the round. Try again in a moment.", 503);
  await audit(getDb(), {
    programId: program.id,
    actor: `user:${session.sub}`,
    action: "round.close_requested",
    entity: "round",
    entityId: round.id,
    data: { number: round.number },
  });
  return Response.json({ ok: true }, { status: 202 });
}
