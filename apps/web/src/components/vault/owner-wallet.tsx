"use client";

import { getChainConfig, shortHex } from "@misthos/shared";
import { Loader2 } from "lucide-react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/web3/wallet-button";

const chain = getChainConfig().chain;

export type WalletProblem =
  "reconnecting" | "disconnected" | "wrong_account" | "wrong_network" | null;

/** What, if anything, stops the signed-in owner from signing right now. */
export function useWalletProblem(owner: string): WalletProblem {
  const { address, status, chainId } = useAccount();
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
  const { address } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { disconnect } = useDisconnect();
  if (problem === "reconnecting")
    return (
      <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Reconnecting your wallet…
      </span>
    );
  if (problem === "disconnected")
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <WalletButton size="sm" label={`Connect ${shortHex(owner)}`} />
        {compact ? <span className="text-muted-foreground">to sign this transaction</span> : null}
      </span>
    );
  if (problem === "wrong_account")
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-warning">
          Your wallet is on {shortHex(address ?? "")}. Switch it to {shortHex(owner)}, the account
          you signed in with.
        </span>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </span>
    );
  if (problem === "wrong_network")
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-warning">Your wallet is on another network.</span>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => switchChain({ chainId: chain.id })}
        >
          {isPending ? "Switching…" : `Switch to ${chain.name}`}
        </Button>
      </span>
    );
  if (compact) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
      Signing as <span className="text-foreground font-mono text-[13px]">{shortHex(owner)}</span>
    </span>
  );
}

/** Shown wherever the wallet cooldown can be set: 0 removes the protection against hijacked payout wallets. */
export function CooldownWarning({ hours }: { hours: string }) {
  if (hours.trim() === "" || Number(hours) !== 0) return null;
  return (
    <p role="status" className="bg-warning-subtle text-warning rounded-md px-3 py-2 text-sm">
      With no cooldown, a payout wallet changed by someone who took over a contributor&apos;s
      account could be paid immediately. 24 hours is the recommended minimum.
    </p>
  );
}
