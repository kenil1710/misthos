"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { shortHex } from "@misthos/shared/money";
import { Loader2 } from "lucide-react";
import { useWalletAccount } from "@/components/web3/use-wallet-account";
import { WalletButton } from "@/components/web3/wallet-button";
import { useHydrated } from "@/lib/use-hydrated";

const chain = getChainConfig().chain;

export type WalletProblem =
  "reconnecting" | "disconnected" | "wrong_account" | "wrong_network" | null;

/** What, if anything, stops the signed-in owner from signing right now. */
export function useWalletProblem(owner: string): WalletProblem {
  const { address, status, chainId } = useWalletAccount();
  if (status === "reconnecting" || status === "connecting") return "reconnecting";
  if (status !== "connected") return "disconnected";
  if (address?.toLowerCase() !== owner.toLowerCase()) return "wrong_account";
  if (chainId !== chain.id) return "wrong_network";
  return null;
}

/**
 * Wallet readiness with the one-click fix for each problem. `compact` is the inline version next to an action: it
 * renders nothing when all is well, because the page header already says which wallet is signing.
 */
export function OwnerWallet({ owner, compact = false }: { owner: string; compact?: boolean }) {
  const problem = useWalletProblem(owner);
  const hydrated = useHydrated();
  if (!hydrated)
    return compact ? null : <span className="inline-block h-7 w-40" aria-hidden="true" />;
  if (problem === "reconnecting")
    return (
      <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Reconnecting your wallet…
      </span>
    );
  // Shown once per page (the header); actions below just say where to connect.
  if (problem === "disconnected")
    return compact ? null : <WalletButton size="sm" label={`Connect ${shortHex(owner)}`} />;
  // Account and network mismatches show as a dot on the wallet chip; the fix dialog opens when an action needs it.
  if (problem === "wrong_account" || problem === "wrong_network") return null;
  if (compact) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
      Signing as <span className="text-foreground font-mono text-[13px]">{shortHex(owner)}</span>
    </span>
  );
}
