import "server-only";
import { getDb, submissions, type DbLike } from "@misthos/db";
import { and, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import { budgetOf, type Budget } from "@/lib/budget";
import { readVaultForPage } from "./vault";

/** Approved work not paid yet, per program, across every round. */
export async function approvedUnpaidBy(
  programIds: string[],
  db: DbLike = getDb(),
): Promise<Map<string, bigint>> {
  if (!programIds.length) return new Map();
  const rows = await db
    .select({
      programId: submissions.programId,
      total: sql<string>`coalesce(sum(${submissions.amount}), 0)::text`,
    })
    .from(submissions)
    .where(
      and(
        inArray(submissions.programId, programIds),
        inArray(submissions.status, ["approved", "partial"]),
      ),
    )
    .groupBy(submissions.programId);
  return new Map(rows.map((r) => [r.programId, BigInt(r.total)]));
}

/** The vault's balance for pages (shared for 15 s, fresh after the owner's own deposit), or null if unreadable. */
export async function vaultBalance(program: {
  vaultAddress: string | null;
  chain: string;
}): Promise<bigint | null> {
  if (!program.vaultAddress) return null;
  const v = await readVaultForPage(program.vaultAddress as Address, program.chain);
  return v?.balance ?? null;
}

/** One program's available budget (balance − approved, unpaid work). */
export async function programBudget(
  program: { id: string; vaultAddress: string | null; chain: string; ratePerPoint: bigint },
  db: DbLike = getDb(),
  balanceOf: typeof vaultBalance = vaultBalance,
): Promise<Budget> {
  const [balance, unpaid] = await Promise.all([
    balanceOf(program),
    approvedUnpaidBy([program.id], db),
  ]);
  return budgetOf({
    balance,
    approvedUnpaid: unpaid.get(program.id) ?? 0n,
    ratePerPoint: program.ratePerPoint,
  });
}
