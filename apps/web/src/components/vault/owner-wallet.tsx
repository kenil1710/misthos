"use client";

import { getChainConfig, shortHex } from "@misthos/shared";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { WalletButton } from "@/components/web3/wallet-button";

const chain = getChainConfig().chain;

/**
 * Wallet readiness for an owner action, with the one-click fix for each problem: connect, switch network, or
 * switch account. Renders "Signing as 0x…" once everything is right.
 */
export function OwnerWallet({ owner }: { owner: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { disconnect } = useDisconnect();
  if (!isConnected) return <WalletButton />;
  if (address?.toLowerCase() !== owner.toLowerCase())
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm">
        <span className="text-warning">
          Connected to {shortHex(address ?? "")}. Switch your wallet to {shortHex(owner)}, the
          account you signed in with.
        </span>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </span>
    );
  if (chainId !== chain.id)
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
