import { cn } from "@/lib/utils";

const styles: Record<string, [string, string]> = {
  approve: ["Approved", "bg-success-subtle text-success"],
  partial: ["Partial", "bg-success-subtle text-success"],
  reject: ["Rejected", "bg-danger-subtle text-danger"],
  escalate: ["In review", "bg-warning-subtle text-warning"],
};

export function ActionBadge({ action }: { action: string }) {
  const [label, cls] = styles[action] ?? [action, "bg-muted text-muted-foreground"];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        cls,
      )}
    >
      {label}
    </span>
  );
}
