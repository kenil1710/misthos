import "server-only";
import { contributors, getDb, payouts, programs, rounds, submissions } from "@misthos/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { currentRound } from "@/lib/rounds";

export interface JoinedProgram {
  contributorId: string;
  program: { id: string; name: string; slug: string; status: string };
  round: { number: number; startsAt: Date; endsAt: Date; status: string } | null;
  waiting: number;
  approved: number;
  approvedAmount: bigint;
  earned: bigint;
}

/** Every program an X account joined, with what's waiting, approved and paid there. Queries run in parallel. */
export async function joinedPrograms(xUserId: string): Promise<JoinedProgram[]> {
  const db = getDb();
  const rows = await db
    .select({ c: contributors, p: programs })
    .from(contributors)
    .innerJoin(programs, eq(programs.id, contributors.programId))
    .where(
      and(
        eq(contributors.xUserId, xUserId),
        ne(contributors.status, "removed"),
        ne(programs.status, "draft"),
      ),
    )
    .orderBy(desc(contributors.createdAt));
  if (!rows.length) return [];
  const cids = rows.map((r) => r.c.id);
  const pids = rows.map((r) => r.p.id);
  const [subs, paid, roundRows] = await Promise.all([
    db
      .select({
        contributorId: submissions.contributorId,
        status: submissions.status,
        n: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${submissions.amount}), 0)::text`,
      })
      .from(submissions)
      .where(inArray(submissions.contributorId, cids))
      .groupBy(submissions.contributorId, submissions.status),
    db
      .select({
        contributorId: payouts.contributorId,
        total: sql<string>`coalesce(sum(${payouts.amount}), 0)::text`,
      })
      .from(payouts)
      .where(and(inArray(payouts.contributorId, cids), eq(payouts.status, "executed")))
      .groupBy(payouts.contributorId),
    db.select().from(rounds).where(inArray(rounds.programId, pids)).orderBy(rounds.number),
  ]);
  return rows.map(({ c, p }) => {
    const mine = subs.filter((s) => s.contributorId === c.id);
    const of = (...st: string[]) => mine.filter((s) => st.includes(s.status));
    const approvedRows = of("approved", "partial");
    const r = currentRound(roundRows.filter((x) => x.programId === p.id));
    return {
      contributorId: c.id,
      program: { id: p.id, name: p.name, slug: p.slug, status: p.status },
      round: r
        ? { number: r.number, startsAt: r.startsAt, endsAt: r.endsAt, status: r.status }
        : null,
      waiting: of("pending", "processing", "escalated").reduce((a, s) => a + s.n, 0),
      approved: approvedRows.reduce((a, s) => a + s.n, 0),
      approvedAmount: approvedRows.reduce((a, s) => a + BigInt(s.amount), 0n),
      earned: BigInt(paid.find((x) => x.contributorId === c.id)?.total ?? "0"),
    };
  });
}
