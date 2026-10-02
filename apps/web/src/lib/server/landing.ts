import "server-only";
import {
  contributors,
  decisions,
  getDb,
  payouts,
  programs,
  rounds,
  submissions,
} from "@misthos/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { computeMetrics } from "./metrics";

/**
 * Everything dynamic on the landing page. Never invents anything: the metrics strip is real non-demo data (hidden at
 * zero), and the featured audit page and decisions come from a real program, falling back to the labeled demo one.
 */
export async function landingData() {
  try {
    const db = getDb();
    const metrics = await computeMetrics(db);
    const showMetrics =
      metrics.submissionsReviewed > 0 && metrics.usdcPaidTestnet + metrics.usdcPaidMainnet > 0n;

    // Prefer a real program that has paid someone; else the most recent public demo program.
    const paidPrograms = await db
      .select({
        id: programs.id,
        slug: programs.slug,
        name: programs.name,
        isDemo: programs.isDemo,
        limits: programs.limitsJson,
        vaultAddress: programs.vaultAddress,
        paid: sql<number>`count(${payouts.id})::int`,
      })
      .from(programs)
      .innerJoin(rounds, eq(rounds.programId, programs.id))
      .innerJoin(payouts, and(eq(payouts.roundId, rounds.id), eq(payouts.status, "executed")))
      .where(ne(programs.status, "draft"))
      .groupBy(programs.id)
      .orderBy(programs.isDemo, desc(sql`count(${payouts.id})`))
      .limit(1);
    const featured = paidPrograms[0] ?? null;

    let examples: { approved: Example | null; rejected: Example | null } = {
      approved: null,
      rejected: null,
    };
    if (featured) {
      const rows = await db
        .select({
          hash: decisions.decisionHash,
          action: decisions.action,
          amount: decisions.amount,
          summary: decisions.summary,
          flags: decisions.flagsJson,
          handle: contributors.xHandle,
          sourceType: submissions.sourceType,
          decidedBy: decisions.decidedBy,
        })
        .from(decisions)
        .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
        .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
        .where(
          and(
            eq(submissions.programId, featured.id),
            eq(decisions.decidedBy, "agent"),
            inArray(decisions.action, ["approve", "reject"]),
          ),
        )
        .orderBy(desc(decisions.createdAt))
        .limit(50);
      const pick = (a: "approve" | "reject") => {
        const r =
          rows.find(
            (x) =>
              x.action === a &&
              (a === "approve" ||
                (x.flags as { code: string }[]).some((f) => f.code === "NEAR_DUPLICATE")),
          ) ?? rows.find((x) => x.action === a);
        return r
          ? { ...r, flags: (r.flags as { code: string; severity: string }[]).map((f) => f.code) }
          : null;
      };
      examples = { approved: pick("approve"), rejected: pick("reject") };
    }
    return { metrics, showMetrics, featured, examples };
  } catch {
    // The landing page must render even if the database is unreachable.
    return {
      metrics: null,
      showMetrics: false,
      featured: null,
      examples: { approved: null, rejected: null },
    };
  }
}

export type Example = {
  hash: string;
  action: string;
  amount: bigint;
  summary: string;
  flags: string[];
  handle: string;
  sourceType: string;
  decidedBy: string;
};

/** A public audit page worth showing a new owner: a published program that has paid someone (demo ones are fine). */
export async function exampleAuditSlug(): Promise<string | null> {
  try {
    const [row] = await getDb()
      .select({ slug: programs.slug })
      .from(programs)
      .innerJoin(rounds, eq(rounds.programId, programs.id))
      .innerJoin(payouts, and(eq(payouts.roundId, rounds.id), eq(payouts.status, "executed")))
      .where(inArray(programs.status, ["active", "paused"]))
      .groupBy(programs.id)
      .orderBy(desc(sql`count(${payouts.id})`))
      .limit(1);
    return row?.slug ?? null;
  } catch {
    return null;
  }
}
