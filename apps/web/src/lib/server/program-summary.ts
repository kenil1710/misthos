import "server-only";
import { contributors, getDb, programMembers, programs, rounds, submissions } from "@misthos/db";
import { formatUsdc } from "@misthos/shared/money";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Address } from "viem";
import { currentRound, isScheduled } from "@/lib/rounds";
import { readVault, readVaultShared, type VaultState } from "./vault";

/** Vault reads for lists and cards: shared for 15s, so an owner with many programs isn't one RPC per program per view. */
const readVaultCached = (address: string) => readVaultShared(address as Address);

export type NeedKind = "review" | "approval" | "payee" | "low_balance";
export interface NeedItem {
  kind: NeedKind;
  text: string;
  href: string;
  action: string;
}

type Program = typeof programs.$inferSelect;
type Round = typeof rounds.$inferSelect;

export interface ProgramSummary {
  program: Program;
  role: "owner" | "reviewer";
  round: (Round & { scheduled: boolean }) | null;
  contributors: number;
  submissions: number;
  /** Submissions in the current round (what the overview's status line counts). */
  roundSubmissions: number;
  waitingReview: number;
  approvedUnpaid: number;
  /** Approved, unpaid work, capped by the per-round limit: what the next close would pay. */
  readyToPay: bigint;
  vault: VaultState | null;
  /** The first unfinished step of getting live, or null once deployed, funded and published. */
  setupNext: "deploy" | "fund" | "publish" | null;
  needs: NeedItem[];
}

/**
 * Per-program numbers for the owner's home, cards and overview: one round trip per table for all programs at once,
 * all queries and vault reads in parallel.
 */
export async function programSummaries(
  userId: string,
  only?: string[],
  now: number = Date.now(),
  /** A program's own pages read the vault fresh (they must reflect a transaction right away); lists may cache. */
  opts: { freshVault?: boolean } = {},
): Promise<ProgramSummary[]> {
  const db = getDb();
  const mine = await db
    .select({ p: programs, role: programMembers.role })
    .from(programMembers)
    .innerJoin(programs, eq(programs.id, programMembers.programId))
    .where(
      and(eq(programMembers.userId, userId), only?.length ? inArray(programs.id, only) : undefined),
    )
    .orderBy(desc(programs.createdAt));
  const ids = mine.map((m) => m.p.id);
  if (!ids.length) return [];

  const [counts, ready, roundRows, people, changes, vaults] = await Promise.all([
    db
      .select({
        programId: submissions.programId,
        roundId: submissions.roundId,
        status: submissions.status,
        n: sql<number>`count(*)::int`,
      })
      .from(submissions)
      .where(inArray(submissions.programId, ids))
      .groupBy(submissions.programId, submissions.roundId, submissions.status),
    db
      .select({
        programId: submissions.programId,
        total: sql<string>`coalesce(sum(${submissions.amount}), 0)::text`,
      })
      .from(submissions)
      .where(
        and(
          inArray(submissions.programId, ids),
          inArray(submissions.status, ["approved", "partial"]),
          isNull(submissions.payoutId),
        ),
      )
      .groupBy(submissions.programId),
    db.select().from(rounds).where(inArray(rounds.programId, ids)).orderBy(rounds.number),
    db
      .select({ programId: contributors.programId, n: sql<number>`count(*)::int` })
      .from(contributors)
      .where(inArray(contributors.programId, ids))
      .groupBy(contributors.programId),
    db
      .select({
        id: contributors.id,
        programId: contributors.programId,
        xHandle: contributors.xHandle,
        walletChangedAt: contributors.walletChangedAt,
      })
      .from(contributors)
      .where(
        and(
          inArray(contributors.programId, ids),
          gt(contributors.walletChangedAt, new Date(now - 7 * 86400_000)),
        ),
      ),
    Promise.all(
      mine.map((m) =>
        m.p.vaultAddress
          ? (opts.freshVault
              ? readVault(m.p.vaultAddress as Address)
              : readVaultCached(m.p.vaultAddress)
            ).catch(() => null)
          : Promise.resolve(null),
      ),
    ),
  ]);

  return mine.map(({ p, role }, i) => {
    const vault = vaults[i] ?? null;
    const own = counts.filter((c) => c.programId === p.id);
    const by = (s: string) => own.filter((c) => c.status === s).reduce((a, c) => a + c.n, 0);
    const total = own.reduce((a, c) => a + c.n, 0);
    const mineRounds = roundRows.filter((r) => r.programId === p.id);
    const cur = currentRound(mineRounds, now);
    const roundSubmissions = cur
      ? own.filter((c) => c.roundId === cur.id).reduce((a, c) => a + c.n, 0)
      : 0;
    const raw = BigInt(ready.find((r) => r.programId === p.id)?.total ?? "0");
    const cap = BigInt(p.limitsJson.maxPerRound);
    const readyToPay = raw > cap ? cap : raw;
    const base = `/app/programs/${p.id}`;
    const cooldown = Math.max(p.limitsJson.payeeCooldownSeconds, 3600) * 1000;

    const needs: NeedItem[] = [];
    const waiting = by("escalated");
    if (waiting)
      needs.push({
        kind: "review",
        text: `${waiting} submission${waiting === 1 ? "" : "s"} waiting for your review`,
        href: `${base}/submissions?status=escalated`,
        action: "Review",
      });
    for (const r of mineRounds)
      if (r.status === "proposed" && vault && r.totalAmount > vault.limits.autoApproveThreshold)
        needs.push({
          kind: "approval",
          text: `Round ${r.number} (${formatUsdc(r.totalAmount)}) is waiting for your approval`,
          href: `${base}/rounds/${r.id}`,
          action: "Approve",
        });
    for (const c of changes)
      if (c.programId === p.id && c.walletChangedAt && now - c.walletChangedAt.getTime() < cooldown)
        needs.push({
          kind: "payee",
          text: `@${c.xHandle} changed their payout wallet. Check it was really them`,
          href: `${base}/contributors/${c.id}`,
          action: "Check",
        });
    if (vault && p.status !== "archived" && readyToPay > vault.balance)
      needs.push({
        kind: "low_balance",
        text: `The vault holds ${formatUsdc(vault.balance)}, less than the ${formatUsdc(readyToPay)} of approved work waiting to be paid`,
        href: `${base}/treasury`,
        action: "Add funds",
      });

    return {
      program: p,
      role,
      round: cur ? { ...cur, scheduled: isScheduled(cur, now) } : null,
      contributors: people.find((x) => x.programId === p.id)?.n ?? 0,
      submissions: total,
      roundSubmissions,
      waitingReview: waiting,
      approvedUnpaid: by("approved") + by("partial"),
      readyToPay,
      vault,
      setupNext: !p.vaultAddress
        ? "deploy"
        : !vault || vault.totalDeposited === 0n
          ? "fund"
          : p.status === "draft"
            ? "publish"
            : null,
      needs,
    };
  });
}

/** One program's summary for a member, or null if they aren't one. */
export async function programSummary(programId: string, userId: string) {
  const [s] = await programSummaries(userId, [programId], undefined, { freshVault: true });
  return s ?? null;
}
