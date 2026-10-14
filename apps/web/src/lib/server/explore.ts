import "server-only";
import type { DbLike } from "@misthos/db";
import { contributors, getDb, programs, rounds } from "@misthos/db";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { isTestProgram, openRoundNow } from "@/lib/explore";
import { approvedUnpaidBy } from "./budget";
import { cached } from "./cache";

export interface OpenCampaign {
  slug: string;
  name: string;
  description: string;
  chain: string;
  /** Public on the audit page too; used to read the balance. The owner's wallet is never selected. */
  vaultAddress: string;
  /** Category names, in the owner's order. */
  paysFor: string[];
  /** The most one piece of work can earn (the best category at full marks). */
  maxPerPiece: bigint;
  round: { number: number; endsAt: Date };
  contributors: number;
  /** For the budget check on the page (balance − this): approved work not paid yet, and one point's worth. */
  approvedUnpaid: bigint;
  ratePerPoint: bigint;
}

/**
 * Campaigns anyone can join right now on one network: published with joining on (`active`, not paused or draft), not
 * ended, a deployed vault, a round taking submissions, and not a demo, QA or test program. (The page also hides those
 * whose budget is used up, once it has read the vault's balance.)
 */
export async function openCampaigns(
  chain: string,
  db: DbLike = getDb(),
  now: number = Date.now(),
): Promise<OpenCampaign[]> {
  const rows = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      description: programs.description,
      chain: programs.chain,
      vaultAddress: programs.vaultAddress,
      rubric: programs.rubricJson,
      ratePerPoint: programs.ratePerPoint,
      isDemo: programs.isDemo,
    })
    .from(programs)
    .where(
      and(
        eq(programs.status, "active"),
        eq(programs.isDemo, false),
        eq(programs.chain, chain),
        isNotNull(programs.vaultAddress),
        isNull(programs.endedAt),
      ),
    );
  const live = rows.filter((p) => !isTestProgram(p));
  if (!live.length) return [];
  const ids = live.map((p) => p.id);
  const [roundRows, counts, unpaid] = await Promise.all([
    db
      .select({
        programId: rounds.programId,
        number: rounds.number,
        startsAt: rounds.startsAt,
        endsAt: rounds.endsAt,
        status: rounds.status,
      })
      .from(rounds)
      .where(and(inArray(rounds.programId, ids), eq(rounds.status, "open"))),
    db
      .select({ programId: contributors.programId, n: sql<number>`count(*)::int` })
      .from(contributors)
      .where(and(inArray(contributors.programId, ids), ne(contributors.status, "removed")))
      .groupBy(contributors.programId),
    approvedUnpaidBy(ids, db),
  ]);
  const out: OpenCampaign[] = [];
  for (const p of live) {
    const round = openRoundNow(
      roundRows.filter((r) => r.programId === p.id),
      now,
    );
    if (!round) continue;
    const cats = p.rubric.categories;
    out.push({
      slug: p.slug,
      name: p.name,
      description: p.description,
      chain: p.chain,
      vaultAddress: p.vaultAddress!,
      paysFor: cats.map((c) => c.name),
      maxPerPiece: cats.reduce((m, c) => {
        const v = p.ratePerPoint * BigInt(c.maxPoints);
        return v > m ? v : m;
      }, 0n),
      round: { number: round.number, endsAt: round.endsAt },
      contributors: Number(counts.find((c) => c.programId === p.id)?.n ?? 0),
      approvedUnpaid: unpaid.get(p.id) ?? 0n,
      ratePerPoint: p.ratePerPoint,
    });
  }
  // Most contributors first, then the round closing soonest.
  return out.sort(
    (a, b) =>
      b.contributors - a.contributors || a.round.endsAt.getTime() - b.round.endsAt.getTime(),
  );
}

/** Shared by every visitor for 45 s; bump the version when the shape or filters change. */
export const openCampaignsCached = cached(
  (chain: string) => openCampaigns(chain),
  ["open-campaigns", "v3"],
  { revalidate: 45, tags: ["public"] },
);
