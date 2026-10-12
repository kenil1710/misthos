import { getChainConfig } from "@misthos/shared/chains";
import { cn } from "@/lib/utils";

/**
 * Which network a campaign (or a record) is on. Mainnet means real USDC, so it's said plainly wherever money shows.
 * Same look as the header's network switch: a dot (amber testnet, green mainnet) and a name.
 */
export function NetworkBadge({
  chain,
  short = false,
  className,
}: {
  chain: string;
  /** "Testnet" / "Mainnet" instead of "Arc Testnet · test USDC" / "Arc Mainnet · real USDC". */
  short?: boolean;
  className?: string;
}) {
  const cfg = getChainConfig(chain);
  const label = short
    ? cfg.isTestnet
      ? "Testnet"
      : "Mainnet"
    : cfg.isTestnet
      ? "Arc Testnet · test USDC"
      : "Arc Mainnet · real USDC";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.isTestnet ? "bg-card text-soft" : "bg-brand-subtle text-brand border-transparent",
        className,
      )}
      data-network={cfg.key}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", cfg.isTestnet ? "bg-warning" : "bg-brand")}
      />
      {label}
    </span>
  );
}
