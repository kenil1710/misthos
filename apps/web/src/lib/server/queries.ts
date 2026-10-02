import "server-only";
import {
  contributors,
  decisions,
  getDb,
  programMembers,
  programs,
  rounds,
  submissions,
} from "@misthos/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

export async function listProgramsForUser(userId: string) {
  return getDb()
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      status: programs.status,
      role: programMembers.role,
      createdAt: programs.createdAt,
    })
    .from(programMembers)
    .innerJoin(programs, eq(programs.id, programMembers.programId))
    .where(eq(programMembers.userId, userId))
    .orderBy(desc(programs.createdAt));
}

/** Program for a member (owner/reviewer), or null — callers must 404 on null, never leak existence. */
export async function getProgramForMember(programId: string, userId: string) {
  const [row] = await getDb()
    .select({ program: programs, role: programMembers.role })
    .from(programs)
    .innerJoin(
      programMembers,
      and(eq(programMembers.programId, programs.id), eq(programMembers.userId, userId)),
    )
    .where(eq(programs.id, programId))
    .limit(1);
  return row ?? null;
}

export async function getProgramBySlug(slug: string) {
  const [p] = await getDb().select().from(programs).where(eq(programs.slug, slug)).limit(1);
  return p ?? null;
}

export async function getRounds(programId: string) {
  return getDb()
    .select()
    .from(rounds)
    .where(eq(rounds.programId, programId))
    .orderBy(asc(rounds.number));
}

export async function listContributors(programId: string) {
  return getDb()
    .select()
    .from(contributors)
    .where(eq(contributors.programId, programId))
    .orderBy(desc(contributors.createdAt));
}

export async function getContributorMembership(programId: string, xUserId: string) {
  const [c] = await getDb()
    .select()
    .from(contributors)
    .where(and(eq(contributors.programId, programId), eq(contributors.xUserId, xUserId)))
    .limit(1);
  return c ?? null;
}

const REVIEW_STATUSES = [
  "pending",
  "processing",
  "approved",
  "partial",
  "rejected",
  "escalated",
  "paid",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const isReviewStatus = (s: unknown): s is ReviewStatus =>
  REVIEW_STATUSES.includes(s as ReviewStatus);

/** Submissions for the owner table, newest first, with the latest decision's summary. */
export async function listSubmissionsForReview(programId: string, status?: ReviewStatus) {
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      url: submissions.url,
      sourceType: submissions.sourceType,
      status: submissions.status,
      amount: submissions.amount,
      createdAt: submissions.createdAt,
      xHandle: contributors.xHandle,
    })
    .from(submissions)
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .where(
      status
        ? and(eq(submissions.programId, programId), eq(submissions.status, status))
        : eq(submissions.programId, programId),
    )
    .orderBy(desc(submissions.createdAt))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const decs = ids.length
    ? await db
        .select({
          submissionId: decisions.submissionId,
          summary: decisions.summary,
          flags: decisions.flagsJson,
          createdAt: decisions.createdAt,
        })
        .from(decisions)
        .where(inArray(decisions.submissionId, ids))
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, (typeof decs)[number]>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);
  return rows.map((r) => {
    const d = latest.get(r.id);
    return {
      ...r,
      amount: r.amount?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
      summary: d?.summary ?? null,
      flags: ((d?.flags as { code: string; severity: string }[] | undefined) ?? []).map((f) => ({
        code: f.code,
        severity: f.severity,
      })),
    };
  });
}

export async function submissionCounts(programId: string) {
  const rows = await getDb()
    .select({ status: submissions.status, n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(eq(submissions.programId, programId))
    .groupBy(submissions.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<
    Record<ReviewStatus, number>
  >;
}

/** Items waiting for a human, per program the user is a member of (for the sidebar badges). */
export async function needsReviewCounts(userId: string) {
  const rows = await getDb()
    .select({ programId: submissions.programId, n: sql<number>`count(*)::int` })
    .from(submissions)
    .innerJoin(
      programMembers,
      and(eq(programMembers.programId, submissions.programId), eq(programMembers.userId, userId)),
    )
    .where(eq(submissions.status, "escalated"))
    .groupBy(submissions.programId);
  return Object.fromEntries(rows.map((r) => [r.programId, Number(r.n)])) as Record<string, number>;
}
