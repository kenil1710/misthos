import "server-only";
import { contributors, decisions, getDb, programs, submissions } from "@misthos/db";
import { desc, eq, inArray } from "drizzle-orm";

/** The latest agent and reviewer decisions across a set of programs, newest first. */
export async function recentDecisions(programIds: string[], limit = 6) {
  if (!programIds.length) return [];
  return getDb()
    .select({
      hash: decisions.decisionHash,
      action: decisions.action,
      amount: decisions.amount,
      summary: decisions.summary,
      decidedBy: decisions.decidedBy,
      createdAt: decisions.createdAt,
      handle: contributors.xHandle,
      programName: programs.name,
      programId: programs.id,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .innerJoin(programs, eq(programs.id, submissions.programId))
    .where(inArray(submissions.programId, programIds))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);
}
