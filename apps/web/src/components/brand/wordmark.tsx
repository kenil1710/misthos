import { cn } from "@/lib/utils";

/** Minimal mark: a ledger line under a vault arc. Pure SVG, inherits currentColor. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5", className)} fill="none">
      <path d="M4 13a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="13" r="1.75" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark className="text-brand" />
      <span className="display text-[1.375rem] leading-none tracking-[-0.01em]">Misthos</span>
    </span>
  );
}
