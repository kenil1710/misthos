import { formatUsdc } from "@misthos/shared/money";
import { fromNow, shortFromNow } from "./when";

type RoundLike = { number: number; startsAt: Date; endsAt: Date; status: string };

/** "Round 1 is open", "ends in 6 days": the round part of a status line. */
export function roundPhrase(round: RoundLike | null, now: number = Date.now()): string[] {
  if (!round) return ["No round yet"];
  const n = `Round ${round.number}`;
  if (round.status === "open") {
    if (round.startsAt.getTime() > now) return [`${n} starts ${fromNow(round.startsAt, now)}`];
    if (round.endsAt.getTime() > now) return [`${n} is open`, `ends ${fromNow(round.endsAt, now)}`];
    return [`${n} is closing`];
  }
  if (round.status === "closed") return [`${n} is closing`];
  if (round.status === "proposed" || round.status === "approved") return [`${n} is being paid`];
  if (round.status === "executed") return [`${n} paid`];
  if (round.status === "failed") return [`${n} payout failed`];
  return [n];
}

/**
 * The one-line program status at the top of its overview, e.g.
 * "Round 1 is open · ends in 6 days · 0 submissions · 4.00 USDC ready to pay".
 */
export function programStatusLine(
  s: {
    status: "draft" | "active" | "paused" | "archived";
    round: RoundLike | null;
    submissions: number;
    readyToPay: bigint;
  },
  now: number = Date.now(),
): string[] {
  if (s.status === "draft") return ["Draft", "join page not published yet"];
  if (s.status === "archived") return ["Archived"];
  return [
    ...(s.status === "paused" ? ["Joining paused"] : []),
    ...roundPhrase(s.round, now),
    `${s.submissions} submission${s.submissions === 1 ? "" : "s"}`,
    `${formatUsdc(s.readyToPay)} ready to pay`,
  ];
}

/** The shell's round pill: "Round 1 · ends in 6d 4h", "Round 2 · starts in 3d", "Round 1 · paying". */
export function roundPill(
  round: { number: number; startsAt: Date; endsAt: Date; status: string } | null,
  now: number = Date.now(),
): string | null {
  if (!round) return null;
  const n = `Round ${round.number}`;
  if (round.status === "open") {
    if (round.startsAt.getTime() > now)
      return `${n} · starts in ${shortFromNow(round.startsAt, now)}`;
    if (round.endsAt.getTime() > now) return `${n} · ends in ${shortFromNow(round.endsAt, now)}`;
    return `${n} · closing`;
  }
  if (round.status === "executed") return `${n} · paid`;
  if (round.status === "failed") return `${n} · payout failed`;
  return `${n} · paying`;
}
