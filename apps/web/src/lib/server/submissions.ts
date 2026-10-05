import "server-only";
import { auditEvents, contributors, programs, submissions, type DbLike } from "@misthos/db";
import { classifySubmissionUrl, QUEUES, SOURCE_LABELS } from "@misthos/shared";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { ensureCurrentRound } from "./rounds";
import { utc } from "@/lib/time";

export const DAILY_SUBMISSION_LIMIT = 20;

export type SubmitResult = { ok: true; submissionId: string } | { ok: false; error: string };

/**
 * Validate and record one submission. Every check that can be done without fetching happens here, so the
 * contributor gets an instant answer; everything else is the agent's job.
 */
export async function createSubmission(
  db: DbLike,
  p: { programSlug: string; xUserId: string; userId: string; url: string; now?: Date },
  enqueue: (queue: string, data: object, key: string) => Promise<unknown>,
): Promise<SubmitResult> {
  const now = p.now ?? new Date();
  const classified = classifySubmissionUrl(p.url);
  if (!classified.ok) return { ok: false, error: classified.error };

  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.slug, p.programSlug))
    .limit(1);
  if (!program || program.status !== "active")
    return { ok: false, error: "This program isn't accepting submissions right now." };
  const [me] = await db
    .select()
    .from(contributors)
    .where(and(eq(contributors.programId, program.id), eq(contributors.xUserId, p.xUserId)))
    .limit(1);
  if (!me || me.userId !== p.userId)
    return { ok: false, error: "Join this program before submitting." };
  if (me.status !== "active")
    return { ok: false, error: "Your membership in this program is suspended." };
  if (!me.walletAddress || !me.walletVerifiedAt)
    return { ok: false, error: "Link and verify your payout wallet first." };

  const accepts = program.rubricJson.categories.some((c) =>
    c.sourceTypes.includes(classified.sourceType),
  );
  if (!accepts)
    return {
      ok: false,
      error: `This program doesn't pay for ${SOURCE_LABELS[classified.sourceType]}.`,
    };
  if (
    (classified.sourceType === "github_pr" || classified.sourceType === "github_commit") &&
    !me.githubUserId
  ) {
    return {
      ok: false,
      error:
        "Connect your GitHub account before submitting GitHub work, so the agent can confirm it's yours.",
    };
  }

  const round = await ensureCurrentRound(db, program, now);
  if (!round)
    return {
      ok: false,
      error: `Round 1 opens on ${utc(program.firstRoundStartsAt)}.`,
    };

  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.contributorId, me.id),
        gte(submissions.createdAt, new Date(now.getTime() - 24 * 3600 * 1000)),
      ),
    )) as [{ n: number }];
  if (n >= DAILY_SUBMISSION_LIMIT)
    return { ok: false, error: `You can submit up to ${DAILY_SUBMISSION_LIMIT} links per day.` };

  // The program's per-round cap, checked before anything is fetched or judged (no API cost for refused work).
  const [{ inRound }] = (await db
    .select({ inRound: sql<number>`count(*)::int` })
    .from(submissions)
    .where(and(eq(submissions.contributorId, me.id), eq(submissions.roundId, round.id)))) as [
    { inRound: number },
  ];
  if (inRound >= program.maxSubmissionsPerRound)
    return {
      ok: false,
      error: `You've reached this program's limit of ${program.maxSubmissionsPerRound} submission${program.maxSubmissionsPerRound === 1 ? "" : "s"} for round ${round.number}. You can submit again when the next round opens (${utc(round.endsAt)}).`,
    };

  const [live] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.contributorId, me.id),
        eq(submissions.sourceType, classified.sourceType),
        eq(submissions.resourceId, classified.resourceId),
        ne(submissions.status, "rejected"),
      ),
    )
    .limit(1);
  if (live) return { ok: false, error: "You've already submitted this." };

  let submissionId: string;
  try {
    submissionId = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(submissions)
        .values({
          programId: program.id,
          roundId: round.id,
          contributorId: me.id,
          url: classified.canonicalUrl,
          sourceType: classified.sourceType,
          resourceId: classified.resourceId,
          createdAt: now,
        })
        .returning({ id: submissions.id });
      await tx.insert(auditEvents).values({
        programId: program.id,
        actor: `user:${p.userId}`,
        action: "submission.created",
        entity: "submission",
        entityId: s!.id,
        dataJson: {
          url: classified.canonicalUrl,
          sourceType: classified.sourceType,
          round: round.number,
        },
      });
      return s!.id;
    });
  } catch (e) {
    if (
      String((e as { cause?: unknown }).cause ?? e).includes(
        "submissions_contributor_resource_live_uq",
      )
    ) {
      return { ok: false, error: "You've already submitted this." };
    }
    throw e;
  }
  // If the queue is briefly unavailable the row stays pending and the worker's sweeper picks it up.
  await enqueue(QUEUES.processSubmission, { submissionId }, submissionId);
  return { ok: true, submissionId };
}
