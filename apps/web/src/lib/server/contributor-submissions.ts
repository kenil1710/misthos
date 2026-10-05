import "server-only";
import { decisions, getDb, payouts, rounds, submissions } from "@misthos/db";
import type { SourceType } from "@misthos/shared/sources";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

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
    action: string;
    amount: string;
    createdAt: string;
    /** The model scored it (false when a check rejected it before judgment). */
    scored: boolean;
    /** Contributor-safe: codes only (labels and fixes come from FLAG_COPY); never the raw message or evidence. */
    flags: { code: string; severity: string; message: string }[];
  } | null;
  /** For the journey's last steps: the round it counts in and, once paid, the payout. */
  round: { number: number; status: string; endsAt: string } | null;
  payout: { status: string; txHash: string | null } | null;
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
          action: decisions.action,
          amount: decisions.amount,
          createdAt: decisions.createdAt,
          scored: sql<boolean>`${decisions.llmOutputJson} is not null`,
          flags: decisions.flagsJson,
        })
        .from(decisions)
        .where(inArray(decisions.submissionId, found))
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, (typeof decs)[number]>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);
  const roundIds = [...new Set(rows.map((r) => r.roundId))];
  const payoutIds = [...new Set(rows.map((r) => r.payoutId).filter((x): x is string => !!x))];
  const [rs, ps] = await Promise.all([
    roundIds.length
      ? db
          .select({
            id: rounds.id,
            number: rounds.number,
            status: rounds.status,
            endsAt: rounds.endsAt,
          })
          .from(rounds)
          .where(inArray(rounds.id, roundIds))
      : Promise.resolve([]),
    payoutIds.length
      ? db
          .select({ id: payouts.id, status: payouts.status, txHash: payouts.txHash })
          .from(payouts)
          .where(inArray(payouts.id, payoutIds))
      : Promise.resolve([]),
  ]);
  const roundById = new Map(rs.map((x) => [x.id, x]));
  const payoutById = new Map(ps.map((x) => [x.id, x]));
  return rows.map((r) => {
    const d = latest.get(r.id);
    const round = roundById.get(r.roundId);
    const payout = r.payoutId ? payoutById.get(r.payoutId) : undefined;
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
            action: d.action,
            amount: d.amount.toString(),
            createdAt: d.createdAt.toISOString(),
            scored: !!d.scored,
            flags: (d.flags as { code: string; severity: string }[]).map((f) => ({
              code: f.code,
              severity: f.severity,
              message: "",
            })),
          }
        : null,
      round: round
        ? { number: round.number, status: round.status, endsAt: round.endsAt.toISOString() }
        : null,
      payout: payout ? { status: payout.status, txHash: payout.txHash } : null,
    };
  });
}
