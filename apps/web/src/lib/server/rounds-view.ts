import "server-only";
import { auditEvents, contributors, getDb, payouts, rounds, submissions } from "@misthos/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

export async function listRounds(programId: string) {
  const db = getDb();
  const rs = await db
    .select()
    .from(rounds)
    .where(eq(rounds.programId, programId))
    .orderBy(desc(rounds.number));
  const counts = await db
    .select({ roundId: payouts.roundId, n: sql<number>`count(*)::int` })
    .from(payouts)
    .where(
      inArray(
        payouts.roundId,
        rs.length ? rs.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"],
      ),
    )
    .groupBy(payouts.roundId);
  const pending = await db
    .select({ roundId: submissions.roundId, n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.programId, programId),
        inArray(submissions.status, ["approved", "partial"]),
      ),
    )
    .groupBy(submissions.roundId);
  const c = new Map(counts.map((x) => [x.roundId, Number(x.n)]));
  const p = new Map(pending.map((x) => [x.roundId, Number(x.n)]));
  return rs.map((r) => ({ ...r, payouts: c.get(r.id) ?? 0, approvedUnpaid: p.get(r.id) ?? 0 }));
}

export async function getRoundDetail(programId: string, roundId: string) {
  const db = getDb();
  const [round] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.programId, programId)))
    .limit(1);
  if (!round) return null;
  const ps = await db
    .select({ p: payouts, xHandle: contributors.xHandle })
    .from(payouts)
    .innerJoin(contributors, eq(contributors.id, payouts.contributorId))
    .where(eq(payouts.roundId, roundId))
    .orderBy(asc(payouts.createdAt));
  const items = ps.length
    ? await db
        .select({ payoutId: submissions.payoutId, id: submissions.id, url: submissions.url })
        .from(submissions)
        .where(
          inArray(
            submissions.payoutId,
            ps.map((x) => x.p.id),
          ),
        )
    : [];
  const events = await db
    .select({
      action: auditEvents.action,
      data: auditEvents.dataJson,
      at: auditEvents.createdAt,
      actor: auditEvents.actor,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.programId, programId), eq(auditEvents.entityId, roundId)))
    .orderBy(asc(auditEvents.createdAt));
  return {
    round,
    payouts: ps.map(({ p, xHandle }) => ({
      ...p,
      xHandle,
      items: items.filter((i) => i.payoutId === p.id),
    })),
    events,
  };
}

export async function treasuryActivity(programId: string) {
  const db = getDb();
  const deposits = await db
    .select({ data: auditEvents.dataJson, at: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.programId, programId), eq(auditEvents.action, "vault.deposit")))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);
  const outflows = await db
    .select({
      amount: payouts.amount,
      txHash: payouts.txHash,
      to: payouts.toAddress,
      roundNumber: rounds.number,
      at: payouts.updatedAt,
      xHandle: contributors.xHandle,
    })
    .from(payouts)
    .innerJoin(rounds, eq(rounds.id, payouts.roundId))
    .innerJoin(contributors, eq(contributors.id, payouts.contributorId))
    .where(and(eq(rounds.programId, programId), eq(payouts.status, "executed")))
    .orderBy(desc(payouts.updatedAt))
    .limit(100);
  return {
    deposits: deposits.map((d) => ({
      ...(d.data as { amount: string; txHash: string; from: string }),
      at: d.at,
    })),
    outflows,
  };
}
