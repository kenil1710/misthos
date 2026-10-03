import { shortFromNow } from "./when";

/**
 * A round's lifecycle as Stepper data: Open → Closed → Payouts planned → Proposed on-chain → Approved by owner (only
 * when the total is above the owner's approval threshold) → Paid. Pure, so the owner page and tests agree.
 */
export interface LifecycleInput {
  status: "open" | "closed" | "proposed" | "approved" | "executed" | "failed" | string;
  scheduled: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Audit events for this round: round.closed, round.planned, round.proposed, round.approved, round.executed. */
  events: { action: string; at: Date }[];
  txHashPropose: string | null;
  txHashApprove: string | null;
  txHashExecute: string | null;
  /** Proposed and above the threshold: the owner has to approve. */
  needsApproval: boolean;
  nothingToPay: boolean;
  lastError: string | null;
}

export interface LifecycleStep {
  key: "open" | "closed" | "planned" | "proposed" | "approved" | "paid";
  label: string;
  state: "done" | "current" | "waiting" | "failed" | "skipped";
  meta?: string;
  at?: Date;
  txHash?: string;
  detail?: string;
}

export function roundLifecycle(r: LifecycleInput, now = Date.now()): LifecycleStep[] {
  const at = (a: string) => r.events.find((e) => e.action === a)?.at;
  const open = r.status === "open";
  const closed = !open;
  const planned = !!at("round.planned") || ["proposed", "approved", "executed"].includes(r.status);
  const proposed = !!r.txHashPropose || ["proposed", "approved", "executed"].includes(r.status);
  const approvedByOwner = !!r.txHashApprove;
  const paid = r.status === "executed";
  const steps: LifecycleStep[] = [
    r.scheduled
      ? {
          key: "open",
          label: "Opens",
          state: "waiting",
          meta: `in ${shortFromNow(r.startsAt, now)}`,
        }
      : open
        ? {
            key: "open",
            label: "Open",
            state: "current",
            meta: `closes in ${shortFromNow(r.endsAt, now)}`,
          }
        : { key: "open", label: "Open", state: "done", at: r.startsAt },
    closed
      ? { key: "closed", label: "Closed", state: "done", at: at("round.closed") ?? r.endsAt }
      : {
          key: "closed",
          label: "Closes",
          state: "waiting",
          meta: r.scheduled ? undefined : `in ${shortFromNow(r.endsAt, now)}`,
        },
  ];
  if (r.nothingToPay) {
    steps.push(
      { key: "planned", label: "Nothing to pay", state: "done", at: at("round.nothing_to_pay") },
      { key: "proposed", label: "Proposed on-chain", state: "skipped" },
      { key: "approved", label: "Approved by owner", state: "skipped" },
      { key: "paid", label: "Paid", state: "skipped" },
    );
    return steps;
  }
  steps.push(
    planned
      ? { key: "planned", label: "Payouts planned", state: "done", at: at("round.planned") }
      : { key: "planned", label: "Payouts planned", state: closed ? "current" : "waiting" },
    proposed
      ? {
          key: "proposed",
          label: "Proposed on-chain",
          state: "done",
          at: at("round.proposed"),
          txHash: r.txHashPropose ?? undefined,
        }
      : { key: "proposed", label: "Proposed on-chain", state: planned ? "current" : "waiting" },
    approvedByOwner
      ? {
          key: "approved",
          label: "Approved by you",
          state: "done",
          at: at("round.approved"),
          txHash: r.txHashApprove!,
        }
      : r.needsApproval
        ? { key: "approved", label: "Waiting for your approval", state: "current" }
        : proposed
          ? { key: "approved", label: "Within your auto-approve limit", state: "skipped" }
          : { key: "approved", label: "Approved by owner (if needed)", state: "waiting" },
    paid
      ? {
          key: "paid",
          label: "Paid",
          state: "done",
          at: at("round.executed"),
          txHash: r.txHashExecute ?? undefined,
        }
      : {
          key: "paid",
          label: "Paid",
          state: proposed && !r.needsApproval ? "current" : "waiting",
        },
  );
  if (r.status === "failed") {
    const i = steps.findIndex((s) => s.state === "current" || s.state === "waiting");
    if (i >= 0) steps[i] = { ...steps[i]!, state: "failed", detail: r.lastError ?? "Failed" };
    for (let j = i + 1; i >= 0 && j < steps.length; j++)
      steps[j] = { ...steps[j]!, state: "skipped" };
  }
  return steps;
}
