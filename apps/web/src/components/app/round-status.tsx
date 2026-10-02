import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  open: "bg-secondary text-foreground",
  closed: "bg-muted text-muted-foreground",
  proposed: "bg-warning-subtle text-warning",
  approved: "bg-brand-subtle text-brand",
  executed: "bg-success-subtle text-success",
  failed: "bg-danger-subtle text-danger",
};

const LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  proposed: "Proposed",
  approved: "Approved",
  executed: "Paid",
  failed: "Failed",
};

export function RoundStatus({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap capitalize",
        styles[status] ?? styles.closed,
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
