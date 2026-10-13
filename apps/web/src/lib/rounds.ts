/** Time-dependent helpers, kept out of component bodies (render must stay pure). */

type RoundLike = { number: number; startsAt: Date; endsAt: Date; status?: string };

/**
 * The open round that has started (even past its end, until the agent closes it), else the round whose window holds
 * now, else the next upcoming one, else the last one. A round closed early is never picked over the open one.
 */
export function currentRound<R extends RoundLike>(
  rounds: R[],
  now: number = Date.now(),
): R | undefined {
  return (
    rounds.find((r) => r.status === "open" && r.startsAt.getTime() <= now) ??
    rounds.find((r) => r.startsAt.getTime() <= now && r.endsAt.getTime() > now) ??
    rounds.find((r) => r.startsAt.getTime() > now) ??
    rounds.at(-1)
  );
}

/** When a changed payout wallet becomes payable, or null if it already is. */
export function cooldownEndsAt(
  walletChangedAt: Date | null,
  cooldownSeconds: number,
  now: number = Date.now(),
): Date | null {
  if (!walletChangedAt) return null;
  const ends = new Date(walletChangedAt.getTime() + cooldownSeconds * 1000);
  return ends.getTime() > now ? ends : null;
}

/** A round whose window hasn't begun yet (shown as "Scheduled", can't be closed). */
export function isScheduled(
  r: { startsAt: Date; status: string },
  now: number = Date.now(),
): boolean {
  return r.status === "open" && r.startsAt.getTime() > now;
}
