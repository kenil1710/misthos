"use client";

import type { ChainKey } from "@misthos/shared/chains";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { rememberNetwork } from "./network-switch";

const NAME: Record<ChainKey, string> = {
  "arc-testnet": "Arc Testnet",
  "arc-mainnet": "Arc Mainnet",
};

/** Switches the header's network (remembered) and re-renders the page for it. */
export function SwitchNetworkButton({
  to,
  children,
  variant = "outline",
}: {
  to: ChainKey;
  children: React.ReactNode;
  variant?: "outline" | "ghost" | "default";
}) {
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      onClick={() => {
        rememberNetwork(to);
        router.refresh();
      }}
    >
      {children}
    </Button>
  );
}

/**
 * Nothing on the selected network yet, while the other one has something: say so, offer to create one here (when this
 * network is offered) and a one-click way back to the other network.
 */
export function NetworkEmpty({
  network,
  what,
  createHref,
  comingSoon = false,
  otherCount,
}: {
  network: ChainKey;
  /** "campaigns" / "programs you joined". */
  what: string;
  createHref?: string;
  /** This network isn't offered for new campaigns yet. */
  comingSoon?: boolean;
  otherCount: number;
}) {
  const other: ChainKey = network === "arc-mainnet" ? "arc-testnet" : "arc-mainnet";
  return (
    <div className="bg-card/50 grid justify-items-center gap-1.5 rounded-[1.25rem] border border-dashed px-6 py-12 text-center">
      <p className="display text-[1.5rem] leading-tight">
        No {what} on {NAME[network]} yet
      </p>
      <p className="text-soft max-w-[46ch] text-sm leading-relaxed">
        {network === "arc-mainnet"
          ? comingSoon
            ? "Campaigns that pay real USDC on Arc Mainnet are coming soon."
            : "Campaigns on Arc Mainnet pay real USDC from a vault you own."
          : "Campaigns on Arc Testnet pay test USDC: free to try."}{" "}
        {otherCount ? `You have ${otherCount} on ${NAME[other]}.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {createHref && !comingSoon ? (
          <Button asChild size="sm">
            <Link href={createHref}>Create a campaign</Link>
          </Button>
        ) : null}
        {otherCount ? (
          <SwitchNetworkButton to={other}>Show {NAME[other]}</SwitchNetworkButton>
        ) : null}
      </div>
    </div>
  );
}
