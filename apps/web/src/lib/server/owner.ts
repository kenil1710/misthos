import "server-only";
import { getDb, programs, rounds } from "@misthos/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError } from "./http";
import { getMembership } from "./programs";
import { getOwnerSession, type OwnerSession } from "./session";

type Program = typeof programs.$inferSelect;
type Round = typeof rounds.$inferSelect;

/** Session + program for an owner-only action, or the error Response to return (404 hides other programs). */
export async function requireProgramOwner(
  programId: string,
): Promise<{ session: OwnerSession; program: Program } | Response> {
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  if (!z.uuid().safeParse(programId).success) return jsonError("not_found", 404);
  const db = getDb();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId)).limit(1);
  if (!program || (await getMembership(db, program.id, session.sub)) !== "owner")
    return jsonError("not_found", 404);
  return { session, program };
}

export async function requireRoundOwner(
  roundId: string,
): Promise<{ session: OwnerSession; program: Program; round: Round } | Response> {
  if (!z.uuid().safeParse(roundId).success) return jsonError("not_found", 404);
  const [round] = await getDb().select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
  if (!round) return jsonError("not_found", 404);
  const owner = await requireProgramOwner(round.programId);
  return owner instanceof Response ? owner : { ...owner, round };
}

export const TxBody = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid transaction hash"),
});
