import "server-only";
import { decisions, getDb, submissions } from "@misthos/db";
import type { SourceType } from "@misthos/shared/sources";
import { and, desc, eq, inArray } from "drizzle-orm";

export interface SubmissionItem {
  id: string;
  url: string;
  sourceType: SourceType;
  status: (typeof submissions.$inferSelect)["status"];
  amount: string | null;
  createdAt: string;
  decision: {
    summary: string;
    decisionHash: string;
    decidedBy: "agent" | "human";
    flags: { code: string; severity: string }[];
  } | null;
}

/**
 * A contributor's submissions with their latest decision, newest first, in the shape the page renders. With `ids`,
 * only those (used by the lightweight status poll).
 */
export async function contributorSubmissionItems(
  contributorId: string,
  ids?: string[],
): Promise<SubmissionItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.contributorId, contributorId),
        ids ? inArray(submissions.id, ids) : undefined,
      ),
    )
    .orderBy(desc(submissions.createdAt))
    .limit(100);
  const found = rows.map((r) => r.id);
  const decs = found.length
    ? await db
        .select({
          submissionId: decisions.submissionId,
          summary: decisions.summary,
          decisionHash: decisions.decisionHash,
          decidedBy: decisions.decidedBy,
          flags: decisions.flagsJson,
        })
        .from(decisions)
        .where(inArray(decisions.submissionId, found))
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, (typeof decs)[number]>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);
  return rows.map((r) => {
    const d = latest.get(r.id);
    return {
      id: r.id,
      url: r.url,
      sourceType: r.sourceType,
      status: r.status,
      amount: r.amount?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
      decision: d
        ? {
            summary: d.summary,
            decisionHash: d.decisionHash,
            decidedBy: d.decidedBy,
            flags: (d.flags as { code: string; severity: string }[]).map((f) => ({
              code: f.code,
              severity: f.severity,
            })),
          }
        : null,
    };
  });
}
