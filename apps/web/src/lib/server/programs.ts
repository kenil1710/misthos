import { programMembers, programs, rounds, type DbLike } from "@misthos/db";
import { toStoredLimits, type ProgramInput } from "@misthos/shared";
import { and, eq } from "drizzle-orm";
import { audit } from "./audit";

export type CreateProgramResult =
  { ok: true; programId: string; slug: string } | { ok: false; error: "slug_taken" };

const DAY_MS = 24 * 3600 * 1000;

/**
 * Create a program as a draft with its owner membership and first round, in one transaction with its audit event.
 * The vault is deployed later from the program's settings (payout phase).
 */
export async function createProgram(
  db: DbLike,
  p: { ownerUserId: string; chain: string; input: ProgramInput },
): Promise<CreateProgramResult> {
  const { basics, rubric, budget, limits } = p.input;
  return db.transaction(async (tx) => {
    const taken = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.slug, basics.slug))
      .limit(1);
    if (taken.length) return { ok: false as const, error: "slug_taken" as const };

    const [program] = await tx
      .insert(programs)
      .values({
        slug: basics.slug,
        name: basics.name,
        description: basics.description,
        logoUrl: basics.logoUrl || null,
        ownerUserId: p.ownerUserId,
        chain: p.chain,
        rubricJson: rubric,
        ratePerPoint: budget.ratePerPoint,
        limitsJson: toStoredLimits(limits, budget),
        autoApproveConfidence: budget.autoApproveConfidence,
        minAccountAgeDays: budget.minAccountAgeDays,
        roundLengthDays: budget.roundLengthDays,
        firstRoundStartsAt: budget.firstRoundStartsAt,
      })
      .returning({ id: programs.id });
    const programId = program!.id;

    await tx.insert(programMembers).values({ programId, userId: p.ownerUserId, role: "owner" });
    const startsAt = budget.firstRoundStartsAt;
    await tx.insert(rounds).values({
      programId,
      number: 1,
      startsAt,
      endsAt: new Date(startsAt.getTime() + budget.roundLengthDays * DAY_MS),
    });
    await audit(tx, {
      programId,
      actor: `user:${p.ownerUserId}`,
      action: "program.created",
      entity: "program",
      entityId: programId,
      data: {
        slug: basics.slug,
        limits: toStoredLimits(limits, budget),
        ratePerPoint: budget.ratePerPoint.toString(),
      },
    });
    return { ok: true as const, programId, slug: basics.slug };
  });
}

/** Owner or reviewer membership check; every owner route goes through this. */
export async function getMembership(db: DbLike, programId: string, userId: string) {
  const [m] = await db
    .select({ role: programMembers.role })
    .from(programMembers)
    .where(and(eq(programMembers.programId, programId), eq(programMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

export async function setProgramStatus(
  db: DbLike,
  p: { programId: string; userId: string; status: "active" | "paused" },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if ((await getMembership(tx, p.programId, p.userId)) !== "owner") return false;
    await tx.update(programs).set({ status: p.status }).where(eq(programs.id, p.programId));
    await audit(tx, {
      programId: p.programId,
      actor: `user:${p.userId}`,
      action: `program.${p.status === "active" ? "published" : "paused"}`,
      entity: "program",
      entityId: p.programId,
    });
    return true;
  });
}
