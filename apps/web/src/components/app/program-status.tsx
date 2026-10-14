import { cn } from "@/lib/utils";

const styles = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success-subtle text-success",
  paused: "bg-warning-subtle text-warning",
  archived: "bg-secondary text-muted-foreground",
  ended: "bg-secondary text-foreground",
} as const;

/** The badge for a program: "ended" once the owner ended it, else its status. */
export const programState = (p: {
  status: Exclude<keyof typeof styles, "ended">;
  endedAt: Date | null;
}) => (p.endedAt ? ("ended" as const) : p.status);

export function ProgramStatus({ status }: { status: keyof typeof styles }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap capitalize",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
