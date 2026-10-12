import { getChainConfig } from "@misthos/shared/chains";
import { cn } from "@/lib/utils";

/** Which network a campaign runs on. Mainnet means real USDC, so it's said plainly wherever money shows. */
export function NetworkBadge({ chain, className }: { chain: string; className?: string }) {
  const cfg = getChainConfig(chain);
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-xs font-medium",
        cfg.isTestnet ? "bg-muted text-muted-foreground" : "bg-brand-subtle text-brand",
        className,
      )}
    >
      {cfg.isTestnet ? "Arc Testnet · test USDC" : "Arc Mainnet · real USDC"}
    </span>
  );
}
