import "server-only";
import {
  auditEvents,
  contributors,
  decisions,
  getDb,
  payouts,
  rounds,
  submissions,
} from "@misthos/db";
import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";

export async function contributorsTable(programId: string) {
  const db = getDb();
  const cs = await db
    .select()
    .from(contributors)
    .where(eq(contributors.programId, programId))
    .orderBy(desc(contributors.createdAt));
  const stats = await db
    .select({
      contributorId: submissions.contributorId,
      total: sql<number>`count(*)::int`,
      paidOrApproved: sql<number>`count(*) filter (where ${submissions.status} in ('approved','partial','paid'))::int`,
      decided: sql<number>`count(*) filter (where ${submissions.status} in ('approved','partial','paid','rejected'))::int`,
    })
    .from(submissions)
    .where(eq(submissions.programId, programId))
    .groupBy(submissions.contributorId);
  const earned = await db
    .select({
      contributorId: payouts.contributorId,
      sum: sql<string>`coalesce(sum(${payouts.amount}),0)::text`,
    })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .where(and(eq(rounds.programId, programId), eq(payouts.status, "executed")))
    .groupBy(payouts.contributorId);
  const flagged = await db
    .select({
      contributorId: submissions.contributorId,
      n: sql<number>`count(distinct ${decisions.submissionId})::int`,
    })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(
      and(
        eq(submissions.programId, programId),
        sql`exists (select 1 from jsonb_array_elements(${decisions.flagsJson}) f where f->>'severity' = 'hard')`,
      ),
    )
    .groupBy(submissions.contributorId);
  const s = new Map(stats.map((x) => [x.contributorId, x]));
  const e = new Map(earned.map((x) => [x.contributorId, BigInt(x.sum)]));
  const f = new Map(flagged.map((x) => [x.contributorId, Number(x.n)]));
  return cs.map((c) => {
    const st = s.get(c.id);
    return {
      ...c,
      submissions: st?.total ?? 0,
      approvalRate: st && st.decided ? st.paidOrApproved / st.decided : null,
      earned: e.get(c.id) ?? 0n,
      flagged: f.get(c.id) ?? 0,
    };
  });
}

export async function contributorDetail(programId: string, contributorId: string) {
  const db = getDb();
  const [c] = await db
    .select()
    .from(contributors)
    .where(and(eq(contributors.id, contributorId), eq(contributors.programId, programId)))
    .limit(1);
  if (!c) return null;
  const subs = await db
    .select()
    .from(submissions)
    .where(eq(submissions.contributorId, c.id))
    .orderBy(desc(submissions.createdAt))
    .limit(200);
  const decs = subs.length
    ? await db
        .select({
          submissionId: decisions.submissionId,
          summary: decisions.summary,
          action: decisions.action,
          hash: decisions.decisionHash,
          flags: decisions.flagsJson,
          createdAt: decisions.createdAt,
        })
        .from(decisions)
        .where(
          inArray(
            decisions.submissionId,
            subs.map((x) => x.id),
          ),
        )
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, (typeof decs)[number]>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);
  const paid = await db
    .select({ p: payouts, roundNumber: rounds.number, roundId: rounds.id })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .where(eq(payouts.contributorId, c.id))
    .orderBy(desc(rounds.number));
  const walletEvents = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityId, c.id),
        or(like(auditEvents.action, "contributor.%"), like(auditEvents.action, "payee.%")),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);
  return {
    contributor: c,
    submissions: subs.map((x) => ({ ...x, decision: latest.get(x.id) ?? null })),
    payouts: paid,
    walletEvents,
  };
}

export const AUDIT_GROUPS = {
  program: ["program.%", "vault.%"],
  decisions: ["decision.%", "submission.%"],
  contributors: ["contributor.%", "payee.%", "owner.%"],
  rounds: ["round.%", "payout.%"],
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;

export async function auditLog(
  programId: string,
  opts: {
    group?: AuditGroup;
    actor?: "agent" | "user" | "system";
    since?: Date;
    limit?: number;
  } = {},
) {
  const conds = [eq(auditEvents.programId, programId)];
  if (opts.group)
    conds.push(or(...AUDIT_GROUPS[opts.group].map((p) => like(auditEvents.action, p)))!);
  if (opts.actor === "user") conds.push(like(auditEvents.actor, "user:%"));
  else if (opts.actor) conds.push(eq(auditEvents.actor, opts.actor));
  if (opts.since) conds.push(gte(auditEvents.createdAt, opts.since));
  return getDb()
    .select()
    .from(auditEvents)
    .where(and(...conds))
    .orderBy(desc(auditEvents.createdAt))
    .limit(opts.limit ?? 500);
}
