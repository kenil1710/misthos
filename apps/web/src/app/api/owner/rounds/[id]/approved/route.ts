import { getDb, rounds } from "@misthos/db";
import { QUEUES } from "@misthos/shared";
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { requireRoundOwner, TxBody } from "@/lib/server/owner";
import { enqueue } from "@/lib/server/queue";
import { ChainVerifyError, findVaultEvent } from "@/lib/server/vault";

/** After the owner's approveRound transaction: confirm RoundApproved for this round, then let the agent execute. */
export async function POST(req: Request, ctx: RouteContext<"/api/owner/rounds/[id]/approved">) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const owner = await requireRoundOwner((await ctx.params).id);
  if (owner instanceof Response) return owner;
  const { session, program, round } = owner;
  if (!program.vaultAddress || !round.roundIdBytes32)
    return jsonError("This round hasn't been proposed.", 409);
  if (round.status !== "proposed" && round.status !== "approved")
    return jsonError(`This round is ${round.status}.`, 409);
  const body = TxBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_body", 400);
  let found;
  try {
    found = await findVaultEvent(
      body.data.txHash as Hex,
      program.vaultAddress as Address,
      "RoundApproved",
    );
  } catch (e) {
    if (e instanceof ChainVerifyError) return jsonError(e.message, 400);
    throw e;
  }
  if (found.log.args.roundId !== round.roundIdBytes32)
    return jsonError("That approval is for a different round.", 400);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(rounds)
      .set({ status: "approved", txHashApprove: body.data.txHash })
      .where(eq(rounds.id, round.id));
    await audit(tx, {
      programId: program.id,
      actor: `user:${session.sub}`,
      action: "round.approved",
      entity: "round",
      entityId: round.id,
      data: { txHash: body.data.txHash },
    });
  });
  await enqueue(QUEUES.runRound, { roundId: round.id, force: false }, `round:${round.id}:execute`);
  return Response.json({ ok: true });
}
