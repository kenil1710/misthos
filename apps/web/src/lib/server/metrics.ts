import "server-only";
import { FRAUD_CODES } from "./public";
import type { DbLike } from "@misthos/db";
import {
  apiUsage,
  contributors,
  decisions,
  getDb,
  payouts,
  programs,
  rounds,
  submissions,
} from "@misthos/db";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";

/**
 * Traction numbers for the hackathon submission. Real rows only: every query is restricted to real programs (not
 * demo, published, with a deployed vault), and USDC paid is split by network. Each submission counts once, by its
 * first agent decision; re-processing or payout re-checks don't add to the counts (F-11).
 */
export async function computeMetrics(db: DbLike = getDb()) {
  const real = await db
    .select({ id: programs.id, chain: programs.chain, status: programs.status })
    .from(programs)
    .where(
      and(
        eq(programs.isDemo, false),
        ne(programs.status, "draft"),
        sql`${programs.vaultAddress} is not null`,
      ),
    );
  const ids = real.map((p) => p.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const inReal = ids.length ? ids : none;

  const [contribs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contributors)
    .where(inArray(contributors.programId, inReal));
  const [active] = await db
    .select({ n: sql<number>`count(distinct ${submissions.contributorId})::int` })
    .from(submissions)
    .where(
      and(
        inArray(submissions.programId, inReal),
        gte(submissions.createdAt, new Date(Date.now() - 30 * 86400_000)),
      ),
    );

  // Agent decisions only (the first verdict on each submission), for auto/escalation rates.
  const firstAgentDecision = sql`not exists (
    select 1 from decisions d0
    where d0.submission_id = ${decisions.submissionId} and d0.decided_by = 'agent' and d0.created_at < ${decisions.createdAt}
  )`;
  const agentRows = await db
    .select({
      action: decisions.action,
      rule: sql<string>`(${decisions.decisionJson}::jsonb)->>'rule'`,
      n: sql<number>`count(*)::int`,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(
      and(
        inArray(submissions.programId, inReal),
        eq(decisions.decidedBy, "agent"),
        firstAgentDecision,
      ),
    )
    .groupBy(decisions.action, sql`(${decisions.decisionJson}::jsonb)->>'rule'`);
  const reviewed = agentRows
    .filter((r) => r.rule !== "R0_PAYOUT_RECHECK")
    .reduce((s, r) => s + Number(r.n), 0);
  const autoApproved = agentRows
    .filter((r) => r.rule === "R10_AUTO_APPROVE")
    .reduce((s, r) => s + Number(r.n), 0);
  const escalated = agentRows
    .filter((r) => r.action === "escalate")
    .reduce((s, r) => s + Number(r.n), 0);

  const flagRows = await db
    .select({
      code: sql<string>`f->>'code'`,
      n: sql<number>`count(distinct ${decisions.submissionId})::int`,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(sql`jsonb_array_elements(${decisions.flagsJson}) f`, sql`true`)
    .where(
      and(
        inArray(submissions.programId, inReal),
        eq(decisions.decidedBy, "agent"),
        sql`f->>'severity' = 'hard'`,
        sql`f->>'code' = any(${sql.raw(`array[${FRAUD_CODES.map((c) => `'${c}'`).join(",")}]`)})`,
      ),
    )
    .groupBy(sql`f->>'code'`);

  const paidRows = await db
    .select({
      chain: programs.chain,
      usdc: sql<string>`coalesce(sum(${payouts.amount}),0)::text`,
      people: sql<number>`count(distinct ${payouts.contributorId})::int`,
    })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .innerJoin(programs, eq(programs.id, rounds.programId))
    .where(and(inArray(programs.id, inReal), eq(payouts.status, "executed")))
    .groupBy(programs.chain);
  const [roundsExecuted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rounds)
    .where(and(inArray(rounds.programId, inReal), eq(rounds.status, "executed")));
  const [median] = await db
    .select({
      s: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${decisions.createdAt} - ${submissions.createdAt})))`,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(
      and(
        inArray(submissions.programId, inReal),
        eq(decisions.decidedBy, "agent"),
        firstAgentDecision,
      ),
    );
  const spend = await db
    .select({
      provider: apiUsage.provider,
      usd: sql<string>`coalesce(sum(${apiUsage.estCostUsd}),0)::text`,
      calls: sql<number>`count(*)::int`,
    })
    .from(apiUsage)
    .where(inArray(apiUsage.programId, inReal))
    .groupBy(apiUsage.provider);

  const paid = (chain: string) => paidRows.find((r) => r.chain === chain);
  return {
    programsOnboarded: real.length,
    programsActive: real.filter((p) => p.status === "active").length,
    contributors: contribs?.n ?? 0,
    activeContributors30d: active?.n ?? 0,
    submissionsReviewed: reviewed,
    autoApprovedPct: reviewed ? autoApproved / reviewed : null,
    escalatedPct: reviewed ? escalated / reviewed : null,
    fraudByFlag: Object.fromEntries(flagRows.map((r) => [r.code, Number(r.n)])) as Record<
      string,
      number
    >,
    usdcPaidTestnet: BigInt(paid("arc-testnet")?.usdc ?? "0"),
    usdcPaidMainnet: BigInt(paid("arc-mainnet")?.usdc ?? "0"),
    contributorsPaid: paidRows.reduce((s, r) => s + Number(r.people), 0),
    roundsExecuted: roundsExecuted?.n ?? 0,
    medianReviewSeconds: median?.s === null || median?.s === undefined ? null : Number(median.s),
    xSpendUsd: Number(spend.find((s) => s.provider === "x")?.usd ?? 0),
    xCalls: spend.find((s) => s.provider === "x")?.calls ?? 0,
    llmSpendUsd: Number(spend.find((s) => s.provider === "anthropic")?.usd ?? 0),
  };
}
export type Metrics = Awaited<ReturnType<typeof computeMetrics>>;
