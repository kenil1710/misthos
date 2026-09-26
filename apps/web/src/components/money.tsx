import { formatUsdc } from "@misthos/shared";
import { cn } from "@/lib/utils";

/** Always "1,234.50 USDC": mono, tabular. `units` are 6-decimal base units. */
export function Money({ units, className }: { units: bigint; className?: string }) {
  return <span className={cn("mono-num whitespace-nowrap", className)}>{formatUsdc(units)}</span>;
}
