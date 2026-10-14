import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Status =
  "pending" | "processing" | "approved" | "partial" | "escalated" | "rejected" | "paid";
/** What a badge can show: a status, or approved work the vault couldn't cover yet (shown, never stored). */
export type BadgeStatus = Status | "waiting_funds";

/** What to show for a submission: approved work the vault couldn't cover reads "Waiting for funds", never "Approved". */
export function shownStatus(status: Status, waitingForFunds: unknown): BadgeStatus {
  return waitingForFunds && (status === "approved" || status === "partial")
    ? "waiting_funds"
    : status;
}

const styles: Record<BadgeStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-muted text-muted-foreground",
  approved: "bg-success-subtle text-success",
  partial: "bg-success-subtle text-success",
  escalated: "bg-warning-subtle text-warning",
  rejected: "bg-danger-subtle text-danger",
  paid: "bg-secondary text-foreground",
  waiting_funds: "bg-warning-subtle text-warning",
};

const labels: Record<BadgeStatus, string> = {
  pending: "Queued",
  processing: "Reviewing",
  approved: "Approved",
  partial: "Partial",
  escalated: "Needs review",
  rejected: "Rejected",
  paid: "Paid",
  waiting_funds: "Waiting for funds",
};

export function StatusBadge({ status, className }: { status: BadgeStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        styles[status],
        className,
      )}
    >
      {status === "paid" ? <Check className="size-3" aria-hidden="true" /> : null}
      {labels[status]}
    </span>
  );
}
