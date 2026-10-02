import { cn } from "@/lib/utils";

const styles = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success-subtle text-success",
  paused: "bg-warning-subtle text-warning",
  archived: "bg-secondary text-muted-foreground",
} as const;

export function ProgramStatus({ status }: { status: keyof typeof styles }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium capitalize",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
