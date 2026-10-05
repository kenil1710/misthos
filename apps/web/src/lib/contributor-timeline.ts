import { formatUsdc } from "@misthos/shared/money";
import type { StepState } from "./journey";

/**
 * A contributor's own timeline in one program: the milestones behind them (joined, wallet, first submission, first
 * approval, first payout, GitHub) and the next one ahead (the open round's close). Pure, for the Stepper.
 */

export interface TimelineInput {
  joinedAt: Date;
  programName: string;
  walletLinkedAt: Date | null;
  githubVerifiedAt: Date | null;
  /** Whether the program pays for GitHub work (otherwise GitHub isn't a milestone). */
  paysGithub: boolean;
  submissions: { createdAt: Date; status: string; decidedAt: Date | null }[];
  payouts: { amount: bigint; status: string; at: Date; roundNumber: number }[];
  round: { number: number; endsAt: Date; open: boolean } | null;
  /** Approved, not yet paid. */
  awaiting: bigint;
}

export interface TimelineStep {
  key: string;
  label: string;
  state: StepState;
  at?: Date;
  detail?: string;
}

const APPROVED = new Set(["approved", "partial", "paid"]);

export function contributorTimeline(t: TimelineInput): TimelineStep[] {
  const earliest = <T>(xs: T[], at: (x: T) => Date | null) =>
    xs
      .map(at)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const firstSubmission = earliest(t.submissions, (s) => s.createdAt);
  const firstApproval = earliest(
    t.submissions.filter((s) => APPROVED.has(s.status)),
    (s) => s.decidedAt ?? s.createdAt,
  );
  const paid = t.payouts.filter((p) => p.status === "executed");
  const firstPayout = [...paid].sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
  const total = paid.reduce((s, p) => s + p.amount, 0n);

  const steps: TimelineStep[] = [
    { key: "joined", label: `Joined ${t.programName}`, state: "done", at: t.joinedAt },
    t.walletLinkedAt
      ? { key: "wallet", label: "Linked a payout wallet", state: "done", at: t.walletLinkedAt }
      : {
          key: "wallet",
          label: "Link a payout wallet",
          state: "current",
          detail: "Payouts need a wallet on Arc.",
        },
  ];
  if (t.paysGithub)
    steps.push(
      t.githubVerifiedAt
        ? { key: "github", label: "Connected GitHub", state: "done", at: t.githubVerifiedAt }
        : {
            key: "github",
            label: "Connect GitHub",
            state: "waiting",
            detail: "Needed before GitHub work can be paid.",
          },
    );
  steps.push(
    firstSubmission
      ? {
          key: "first-submission",
          label:
            t.submissions.length === 1
              ? "First submission"
              : `First submission · ${t.submissions.length} so far`,
          state: "done",
          at: firstSubmission,
        }
      : {
          key: "first-submission",
          label: "Submit your first piece of work",
          state: t.walletLinkedAt ? "current" : "waiting",
        },
    firstApproval
      ? { key: "first-approval", label: "First approval", state: "done", at: firstApproval }
      : {
          key: "first-approval",
          label: "First approval",
          state: firstSubmission ? "current" : "waiting",
          detail: firstSubmission
            ? "The agent is reviewing, or it wasn't approved yet."
            : undefined,
        },
    firstPayout
      ? {
          key: "first-payout",
          label:
            paid.length === 1
              ? `First payout · ${formatUsdc(firstPayout.amount)}`
              : `First payout · ${formatUsdc(total)} paid in ${paid.length} payouts`,
          state: "done",
          at: firstPayout.at,
        }
      : {
          key: "first-payout",
          label: "First payout",
          state: "waiting",
          detail:
            t.awaiting > 0n && t.round?.open
              ? `${formatUsdc(t.awaiting)} approved, paid when round ${t.round.number} closes.`
              : undefined,
        },
  );
  // What's next: the open round's close, while there's something it would pay.
  if (t.round?.open && (t.awaiting > 0n || firstPayout))
    steps.push({
      key: "round-close",
      label: `Round ${t.round.number} closes`,
      state: "waiting",
      at: t.round.endsAt,
      detail: t.awaiting > 0n ? `${formatUsdc(t.awaiting)} approved so far` : undefined,
    });
  return steps;
}
