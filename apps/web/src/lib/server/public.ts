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
import { Slug } from "@misthos/shared";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

/** Programs with a public page: anything past draft. */
export async function getPublicProgram(slug: string) {
  const parsed = Slug.safeParse(slug);
  if (!parsed.success) return null;
  const [p] = await getDb()
    .select()
    .from(programs)
    .where(and(eq(programs.slug, parsed.data), ne(programs.status, "draft")))
    .limit(1);
  return p ?? null;
}

const HARD_REJECT_CODES = [
  "OWNERSHIP_MISMATCH",
  "DUPLICATE_URL",
  "NEAR_DUPLICATE",
  "OUT_OF_WINDOW",
  "PROMPT_INJECTION_ATTEMPT",
];

export async function publicStats(programId: string, db: DbLike = getDb()) {
  const [paid] = await db
    .select({
      usdc: sql<string>`coalesce(sum(${payouts.amount}), 0)::text`,
      contributors: sql<number>`count(distinct ${payouts.contributorId})::int`,
    })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .where(and(eq(rounds.programId, programId), eq(payouts.status, "executed")));
  const [reviewed] = await db
    .select({ n: sql<number>`count(distinct ${decisions.submissionId})::int` })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(eq(submissions.programId, programId));
  // Fraud caught: submissions whose agent decision carried a hard fraud flag (copied, someone else's, injection…).
  const [fraud] = await db
    .select({ n: sql<number>`count(distinct ${decisions.submissionId})::int` })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(
      and(
        eq(submissions.programId, programId),
        eq(decisions.decidedBy, "agent"),
        sql`exists (select 1 from jsonb_array_elements(${decisions.flagsJson}) f where f->>'severity' = 'hard' and f->>'code' = any(${sql.raw(`array[${HARD_REJECT_CODES.map((c) => `'${c}'`).join(",")}]`)}))`,
      ),
    );
  const [roundsPaid] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rounds)
    .where(and(eq(rounds.programId, programId), eq(rounds.status, "executed")));
  return {
    usdcPaid: BigInt(paid?.usdc ?? "0"),
    contributorsPaid: paid?.contributors ?? 0,
    reviewed: reviewed?.n ?? 0,
    fraudCaught: fraud?.n ?? 0,
    roundsPaid: roundsPaid?.n ?? 0,
  };
}

export async function publicRounds(programId: string) {
  const db = getDb();
  const rs = await db
    .select()
    .from(rounds)
    .where(eq(rounds.programId, programId))
    .orderBy(desc(rounds.number));
  const counts = rs.length
    ? await db
        .select({ roundId: payouts.roundId, n: sql<number>`count(*)::int` })
        .from(payouts)
        .where(
          and(
            inArray(
              payouts.roundId,
              rs.map((r) => r.id),
            ),
            eq(payouts.status, "executed"),
          ),
        )
        .groupBy(payouts.roundId)
    : [];
  const c = new Map(counts.map((x) => [x.roundId, Number(x.n)]));
  return rs.map((r) => ({ ...r, paidCount: c.get(r.id) ?? 0 }));
}

/** Executed payouts (optionally for one round) with the decisions each one covers. */
export async function publicPayouts(programId: string, roundId?: string) {
  const db = getDb();
  const rows = await db
    .select({
      p: payouts,
      handle: contributors.xHandle,
      roundNumber: rounds.number,
      roundId: rounds.id,
    })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .innerJoin(contributors, eq(contributors.id, payouts.contributorId))
    .where(
      and(
        eq(rounds.programId, programId),
        roundId ? eq(rounds.id, roundId) : sql`true`,
        inArray(payouts.status, roundId ? ["executed", "proposed", "pending"] : ["executed"]),
      ),
    )
    .orderBy(desc(rounds.number), desc(payouts.amount))
    .limit(500);
  const items = rows.length
    ? await db
        .select({
          payoutId: submissions.payoutId,
          submissionId: submissions.id,
          url: submissions.url,
          sourceType: submissions.sourceType,
        })
        .from(submissions)
        .where(
          inArray(
            submissions.payoutId,
            rows.map((r) => r.p.id),
          ),
        )
    : [];
  const decs = items.length
    ? await db
        .select({
          submissionId: decisions.submissionId,
          hash: decisions.decisionHash,
          createdAt: decisions.createdAt,
        })
        .from(decisions)
        .where(
          inArray(
            decisions.submissionId,
            items.map((i) => i.submissionId),
          ),
        )
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, string>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d.hash);
  return rows.map(({ p, handle, roundNumber, roundId: rid }) => ({
    id: p.id,
    handle,
    roundNumber,
    roundId: rid,
    amount: p.amount,
    to: p.toAddress,
    txHash: p.txHash,
    status: p.status,
    payoutIdBytes32: p.payoutIdBytes32,
    decisionHash: p.decisionHash,
    items: items
      .filter((i) => i.payoutId === p.id)
      .map((i) => ({ ...i, decisionHash: latest.get(i.submissionId) ?? null })),
  }));
}

export async function publicDecisions(programId: string, limit = 25) {
  return getDb()
    .select({
      hash: decisions.decisionHash,
      action: decisions.action,
      amount: decisions.amount,
      summary: decisions.summary,
      decidedBy: decisions.decidedBy,
      createdAt: decisions.createdAt,
      handle: contributors.xHandle,
      url: submissions.url,
      sourceType: submissions.sourceType,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(contributors, eq(contributors.id, submissions.contributorId))
    .where(eq(submissions.programId, programId))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);
}

export async function decisionRecord(hash: string) {
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return null;
  const [d] = await getDb()
    .select({ json: decisions.decisionJson, programStatus: programs.status })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(programs, eq(programs.id, submissions.programId))
    .where(eq(decisions.decisionHash, hash))
    .limit(1);
  return d && d.programStatus !== "draft" ? d.json : null;
}
