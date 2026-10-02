import { rounds } from "./schema";
import type { DbLike } from "./client";
import { desc, eq } from "drizzle-orm";

const DAY_MS = 24 * 3600 * 1000;

/**
 * The round open at `now`, creating consecutive rounds lazily as time passes. Returns null before round 1 starts.
 */
export async function ensureCurrentRound(
  db: DbLike,
  program: { id: string; roundLengthDays: number },
  now = new Date(),
): Promise<typeof rounds.$inferSelect | null> {
  for (let guard = 0; guard < 120; guard++) {
    const [latest] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.programId, program.id))
      .orderBy(desc(rounds.number))
      .limit(1);
    if (!latest) return null;
    if (now < latest.startsAt) {
      if (latest.number === 1) return null;
      const [prev] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.programId, program.id))
        .orderBy(desc(rounds.number))
        .offset(1)
        .limit(1);
      return prev && now >= prev.startsAt && now < prev.endsAt ? prev : null;
    }
    if (now < latest.endsAt) return latest;
    // Past the latest round: open the next one (unique (program, number) makes concurrent creators safe).
    await db
      .insert(rounds)
      .values({
        programId: program.id,
        number: latest.number + 1,
        startsAt: latest.endsAt,
        endsAt: new Date(latest.endsAt.getTime() + program.roundLengthDays * DAY_MS),
      })
      .onConflictDoNothing();
  }
  return null;
}
