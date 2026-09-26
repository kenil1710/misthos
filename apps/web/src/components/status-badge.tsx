import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Status =
  "pending" | "processing" | "approved" | "partial" | "escalated" | "rejected" | "paid";

const styles: Record<Status, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-muted text-muted-foreground",
  approved: "bg-success-subtle text-success",
  partial: "bg-success-subtle text-success",
  escalated: "bg-warning-subtle text-warning",
  rejected: "bg-danger-subtle text-danger",
  paid: "bg-secondary text-foreground",
};

const labels: Record<Status, string> = {
  pending: "Pending",
  processing: "Processing",
  approved: "Approved",
  partial: "Partial",
  escalated: "Escalated",
  rejected: "Rejected",
  paid: "Paid",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      {status === "paid" ? <Check className="size-3" aria-hidden="true" /> : null}
      {labels[status]}
    </span>
  );
}
