"use client";

import { shortHex } from "@misthos/shared";
import { ConnectKitButton } from "connectkit";
import { useAccount } from "wagmi";

/**
 * The signing wallet for owner actions. Once the owner's wallet is connected it just says so; the Connect button only
 * appears when nothing (or the wrong wallet) is connected.
 */
export function OwnerWallet({ owner }: { owner: string }) {
  const { address, isConnected } = useAccount();
  if (isConnected && address?.toLowerCase() === owner.toLowerCase()) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
        Signing as <span className="text-foreground font-mono text-[13px]">{shortHex(owner)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ConnectKitButton />
      {isConnected ? (
        <span className="text-warning text-xs">
          Switch to {shortHex(owner)}, the wallet you signed in with.
        </span>
      ) : null}
    </span>
  );
}

/** Shown wherever the wallet cooldown can be set: 0 removes the protection against hijacked payout wallets. */
export function CooldownWarning({ hours }: { hours: string }) {
  if (Number(hours) !== 0) return null;
  return (
    <p role="status" className="bg-warning-subtle text-warning rounded-md px-3 py-2 text-sm">
      With no cooldown, a payout wallet changed by someone who took over a contributor&apos;s
      account could be paid immediately. 24 hours is the recommended minimum.
    </p>
  );
}
