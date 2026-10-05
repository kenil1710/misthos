import "server-only";
import {
  appeals,
  auditEvents,
  contributors,
  decisions,
  submissions,
  type DbLike,
} from "@misthos/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

/** Second looks a contributor can ask for per day, across programs. */
export const DAILY_APPEALS = 5;

export type AppealResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * "Ask for a second look" at a rejected or partly paid decision: the contributor's own submission, once per
 * submission, at most DAILY_APPEALS a day, never once it's in a payout. Recorded with the decision it questions.
 */
export async function requestAppeal(
  db: DbLike,
  p: { userId: string; submissionId: string; note: string; now?: Date },
): Promise<AppealResult> {
  const now = p.now ?? new Date();
  const [row] = await db
    .select({ s: submissions, c: contributors })
    .from(submissions)
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .where(eq(submissions.id, p.submissionId))
    .limit(1);
  if (!row || row.c.userId !== p.userId) return { ok: false, status: 404, error: "not_found" };
  if (row.s.payoutId || row.s.status === "paid")
    return { ok: false, status: 409, error: "This submission is already being paid." };
  const [latest] = await db
    .select({ action: decisions.action, hash: decisions.decisionHash })
    .from(decisions)
    .where(eq(decisions.submissionId, p.submissionId))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  if (!latest || (latest.action !== "reject" && latest.action !== "partial"))
    return {
      ok: false,
      status: 409,
      error: "You can ask for a second look at a rejected or partly paid submission.",
    };
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appeals)
    .where(
      and(
        eq(appeals.contributorId, row.c.id),
        gte(appeals.createdAt, new Date(now.getTime() - 24 * 3600_000)),
      ),
    )) as [{ n: number }];
  if (n >= DAILY_APPEALS)
    return {
      ok: false,
      status: 429,
      error: `You can ask for up to ${DAILY_APPEALS} second looks a day.`,
    };
  const inserted = await db.transaction(async (tx) => {
    const [a] = await tx
      .insert(appeals)
      .values({
        submissionId: p.submissionId,
        contributorId: row.c.id,
        programId: row.s.programId,
        note: p.note,
        decisionHash: latest.hash,
      })
      .onConflictDoNothing({ target: appeals.submissionId })
      .returning({ id: appeals.id });
    if (!a) return false;
    await tx.insert(auditEvents).values({
      programId: row.s.programId,
      actor: `user:${p.userId}`,
      action: "appeal.requested",
      entity: "submission",
      entityId: p.submissionId,
      dataJson: { decisionHash: latest.hash, note: p.note },
    });
    return true;
  });
  if (!inserted)
    return { ok: false, status: 409, error: "You already asked for a second look at this one." };
  return { ok: true };
}
