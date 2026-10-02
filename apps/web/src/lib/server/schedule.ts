import "server-only";
import { programs, rounds, type DbLike } from "@misthos/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { audit } from "./audit";

const DAY_MS = 24 * 3600 * 1000;

export type ScheduleResult =
  | { ok: true; round: { number: number; startsAt: Date; endsAt: Date } }
  | { ok: false; error: string };

async function latestRound(db: DbLike, programId: string) {
  const [r] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.programId, programId))
    .orderBy(desc(rounds.number))
    .limit(1);
  return r ?? null;
}

/**
 * Start the upcoming round now instead of at its scheduled time. Only a round that hasn't started can be started
 * early; its length is kept. Audited.
 */
export async function startRoundNow(
  db: DbLike,
  p: { programId: string; actor: string; now?: Date; reason?: string },
): Promise<ScheduleResult> {
  const now = p.now ?? new Date();
  const r = await latestRound(db, p.programId);
  if (!r) return { ok: false, error: "This program has no rounds yet." };
  if (r.startsAt <= now) return { ok: false, error: `Round ${r.number} has already started.` };
  const [program] = await db
    .select({ len: programs.roundLengthDays })
    .from(programs)
    .where(eq(programs.id, p.programId));
  const endsAt = new Date(now.getTime() + program!.len * DAY_MS);
  const updated = await db
    .update(rounds)
    .set({ startsAt: now, endsAt })
    .where(and(eq(rounds.id, r.id), gt(rounds.startsAt, now)))
    .returning({ id: rounds.id });
  if (!updated.length) return { ok: false, error: `Round ${r.number} has already started.` };
  if (r.number === 1)
    await db.update(programs).set({ firstRoundStartsAt: now }).where(eq(programs.id, p.programId));
  await audit(db, {
    programId: p.programId,
    actor: p.actor,
    action: "round.started_early",
    entity: "round",
    entityId: r.id,
    data: {
      number: r.number,
      scheduledFor: r.startsAt.toISOString(),
      startedAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      ...(p.reason ? { reason: p.reason } : {}),
    },
  });
  return { ok: true, round: { number: r.number, startsAt: now, endsAt } };
}

/**
 * Change the round length (applies to the upcoming round if it hasn't started, and every round after the current
 * one) and, for a round that hasn't started, when it starts. A running round keeps its end date. Audited.
 */
export async function updateSchedule(
  db: DbLike,
  p: { programId: string; actor: string; roundLengthDays: number; startsAt?: Date; now?: Date },
): Promise<ScheduleResult> {
  const now = p.now ?? new Date();
  if (!Number.isInteger(p.roundLengthDays) || p.roundLengthDays < 1 || p.roundLengthDays > 90)
    return { ok: false, error: "Round length must be between 1 and 90 days." };
  const r = await latestRound(db, p.programId);
  if (!r) return { ok: false, error: "This program has no rounds yet." };
  const [program] = await db
    .select({ len: programs.roundLengthDays })
    .from(programs)
    .where(eq(programs.id, p.programId));
  const scheduled = r.startsAt > now;
  if (p.startsAt && !scheduled)
    return { ok: false, error: `Round ${r.number} is already running; its start can't change.` };
  if (p.startsAt && p.startsAt.getTime() < now.getTime() - 60_000)
    return { ok: false, error: "Pick a start time in the future, or start the round now." };

  await db
    .update(programs)
    .set({ roundLengthDays: p.roundLengthDays })
    .where(eq(programs.id, p.programId));
  let round = { number: r.number, startsAt: r.startsAt, endsAt: r.endsAt };
  if (scheduled) {
    const startsAt = p.startsAt ?? r.startsAt;
    const endsAt = new Date(startsAt.getTime() + p.roundLengthDays * DAY_MS);
    await db.update(rounds).set({ startsAt, endsAt }).where(eq(rounds.id, r.id));
    if (r.number === 1)
      await db
        .update(programs)
        .set({ firstRoundStartsAt: startsAt })
        .where(eq(programs.id, p.programId));
    round = { number: r.number, startsAt, endsAt };
  }
  await audit(db, {
    programId: p.programId,
    actor: p.actor,
    action: "program.schedule_updated",
    entity: "program",
    entityId: p.programId,
    data: {
      round: r.number,
      roundLengthDays: { from: program!.len, to: p.roundLengthDays },
      ...(scheduled && p.startsAt
        ? { startsAt: { from: r.startsAt.toISOString(), to: p.startsAt.toISOString() } }
        : {}),
      appliesTo: scheduled ? `round ${r.number} onward` : `rounds after ${r.number}`,
    },
  });
  return { ok: true, round };
}
