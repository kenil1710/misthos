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
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import { readVault } from "./vault";

/** Everything on /app for one owner, across every program they're a member of. */
export async function ownerOverview(userId: string) {
  const db = getDb();
  const mine = await db
    .select({ p: programs, role: programMembers.role })
    .from(programMembers)
    .innerJoin(programs, eq(programs.id, programMembers.programId))
    .where(eq(programMembers.userId, userId))
    .orderBy(desc(programs.createdAt));
  const ids = mine.map((m) => m.p.id);
  if (!ids.length) return null;

  const vaults = await Promise.all(
    mine.map(async (m) => ({
      id: m.p.id,
      state: m.p.vaultAddress
        ? await readVault(m.p.vaultAddress as Address).catch(() => null)
        : null,
    })),
  );
  const state = new Map(vaults.map((v) => [v.id, v.state]));

  const statusRows = await db
    .select({ status: submissions.status, n: sql<number>`count(*)::int` })
    .from(submissions)
    .where(inArray(submissions.programId, ids))
    .groupBy(submissions.status);
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])) as Record<
    string,
    number
  >;

  const [fraud] = await db
    .select({ n: sql<number>`count(distinct ${decisions.submissionId})::int` })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(
      and(
        inArray(submissions.programId, ids),
        eq(decisions.decidedBy, "agent"),
        sql`exists (select 1 from jsonb_array_elements(${decisions.flagsJson}) f where f->>'severity' = 'hard' and f->>'code' in ('OWNERSHIP_MISMATCH','DUPLICATE_URL','NEAR_DUPLICATE','OUT_OF_WINDOW','PROMPT_INJECTION_ATTEMPT'))`,
      ),
    );

  // Next payout: approved, unpaid, unassigned work per program, capped by its per-round limit; due at the open round's end.
  const approved = await db
    .select({
      programId: submissions.programId,
      total: sql<string>`coalesce(sum(${submissions.amount}), 0)::text`,
    })
    .from(submissions)
    .where(
      and(
        inArray(submissions.programId, ids),
        inArray(submissions.status, ["approved", "partial"]),
        sql`${submissions.payoutId} is null`,
      ),
    )
    .groupBy(submissions.programId);
  const openRounds = await db
    .select()
    .from(rounds)
    .where(and(inArray(rounds.programId, ids), eq(rounds.status, "open")));
  const forecast = mine
    .filter((m) => m.p.vaultAddress)
    .map((m) => {
      const raw = BigInt(approved.find((a) => a.programId === m.p.id)?.total ?? "0");
      const cap = BigInt(m.p.limitsJson.maxPerRound);
      const round = openRounds.find((r) => r.programId === m.p.id);
      return {
        program: m.p,
        amount: raw > cap ? cap : raw,
        capped: raw > cap,
        dueAt: round?.endsAt ?? null,
      };
    })
    .filter((f) => f.amount > 0n)
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  const awaiting = await db
    .select({ r: rounds, name: programs.name })
    .from(rounds)
    .innerJoin(programs, eq(programs.id, rounds.programId))
    .where(and(inArray(rounds.programId, ids), eq(rounds.status, "proposed")));
  const awaitingApproval = awaiting.filter(({ r }) => {
    const s = state.get(r.programId);
    return s && r.totalAmount > s.limits.autoApproveThreshold;
  });

  const payeeChanges = await db
    .select({
      c: contributors,
      name: programs.name,
      cooldown: sql<number>`(${programs.limitsJson}->>'payeeCooldownSeconds')::int`,
    })
    .from(contributors)
    .innerJoin(programs, eq(programs.id, contributors.programId))
    .where(
      and(
        inArray(contributors.programId, ids),
        gt(contributors.walletChangedAt, new Date(Date.now() - 7 * 86400_000)),
      ),
    );

  const feed = await db
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
    .where(inArray(submissions.programId, ids))
    .orderBy(desc(decisions.createdAt))
    .limit(12);

  return {
    programs: mine.map((m) => ({ ...m.p, role: m.role, vault: state.get(m.p.id) ?? null })),
    vaultBalance: [...state.values()].reduce((s, v) => s + (v?.balance ?? 0n), 0n),
    vaultCount: [...state.values()].filter(Boolean).length,
    byStatus,
    fraudCaught: fraud?.n ?? 0,
    forecast,
    awaitingApproval,
    payeeChanges: payeeChanges.filter(
      ({ c, cooldown }) =>
        c.walletChangedAt &&
        Date.now() - c.walletChangedAt.getTime() < Math.max(cooldown, 86400) * 1000,
    ),
    feed,
  };
}
