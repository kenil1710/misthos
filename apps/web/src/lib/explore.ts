/** What the public "Explore campaigns" page lists, kept pure so the rules are testable without a database. */

/**
 * Our own QA and e2e programs, by exact slug prefix ("qa-<run>", "e2e-…"), and seeded demo programs (`isDemo`). Names
 * never count: a real campaign may be called "Testnet Builders" or "Demo Day Creators".
 */
const TEST_SLUG = /^(qa|e2e)-/;

export function isTestProgram(p: { slug: string; isDemo?: boolean }): boolean {
  return !!p.isDemo || TEST_SLUG.test(p.slug);
}

type RoundLike = { startsAt: Date; endsAt: Date; status: string };

/** The round taking submissions right now: open, started, and not past its end. */
export function openRoundNow<R extends RoundLike>(rounds: R[], now: number = Date.now()): R | null {
  return (
    rounds.find(
      (r) => r.status === "open" && r.startsAt.getTime() <= now && r.endsAt.getTime() > now,
    ) ?? null
  );
}

/** Drops campaigns whose round ended since the (briefly cached) list was read. */
export function stillOpen<C extends { round: { endsAt: Date } }>(
  list: C[],
  now: number = Date.now(),
): C[] {
  return list.filter((c) => c.round.endsAt.getTime() > now);
}
