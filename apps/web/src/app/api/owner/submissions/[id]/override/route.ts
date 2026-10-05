import { getDb, programs, submissions } from "@misthos/db";
import { parseUsdc, QUEUES } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { getMembership } from "@/lib/server/programs";
import { enqueue } from "@/lib/server/queue";
import { getOwnerSession } from "@/lib/server/session";

const reason = z.string().trim().min(10, "Write at least a sentence (10+ characters).").max(1000);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter an amount like 12.50"),
    reason,
  }),
  z.object({ action: z.literal("reject"), reason }),
]);

/**
 * Reviewer override. Validated here; signed and recorded by the worker (which holds the agent signer), so the web
 * app never touches signing keys. The audit trail records the request now and the signed decision when written.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/owner/submissions/[id]/override">,
) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "invalid_body", 400);

  const db = getDb();
  const [row] = await db
    .select({ s: submissions, limits: programs.limitsJson })
    .from(submissions)
    .innerJoin(programs, eq(programs.id, submissions.programId))
    .where(eq(submissions.id, id))
    .limit(1);
  if (!row || !(await getMembership(db, row.s.programId, session.sub)))
    return jsonError("not_found", 404);
  if (row.s.status === "pending" || row.s.status === "processing")
    return jsonError("The agent hasn't decided yet.", 409);
  if (row.s.status === "paid") return jsonError("This submission was already paid.", 409);
  // A planned round pays this item on execution whatever is recorded here, so don't pretend an override stops it.
  if (row.s.payoutId)
    return jsonError(
      "This item is already in a payout round. To stop it, cancel that round or pause the vault.",
      409,
    );

  let amount: string | undefined;
  if (body.data.action === "approve") {
    const units = parseUsdc(body.data.amount);
    if (units <= 0n) return jsonError("The amount must be above zero.", 400);
    if (units > BigInt(row.limits.maxPerPayout))
      return jsonError("The amount is above the vault's per-payout limit.", 400);
    amount = units.toString();
  }
  const job = {
    submissionId: id,
    userId: session.sub,
    action: body.data.action,
    amount,
    reason: body.data.reason,
  };
  const ok = await enqueue(QUEUES.overrideDecision, job, `${id}:${Date.now()}`);
  if (ok === "failed") return jsonError("Couldn't queue the override. Try again in a moment.", 503);
  await audit(db, {
    programId: row.s.programId,
    actor: `user:${session.sub}`,
    action: "decision.override_requested",
    entity: "submission",
    entityId: id,
    data: { action: job.action, amount: amount ?? null },
  });
  return Response.json({ ok: true }, { status: 202 });
}
