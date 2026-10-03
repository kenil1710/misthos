"use client";

import { shortHex } from "@misthos/shared/money";
import { useState } from "react";
import { useWalletProblem } from "@/components/vault/owner-wallet";
import { cn } from "@/lib/utils";
import { WalletFixDialog } from "./wallet-fix";
import { useWalletUi } from "./web3-provider";

const STATE = {
  ok: { dot: "bg-success", text: "Wallet ready" },
  reconnecting: { dot: "bg-muted-foreground animate-pulse", text: "Reconnecting…" },
  disconnected: { dot: "bg-muted-foreground/60", text: "Connect wallet" },
  wrong_account: { dot: "bg-warning", text: "Other account in wallet" },
  wrong_network: { dot: "bg-warning", text: "Wrong network" },
} as const;

/**
 * The owner's account at the bottom of the rail, with the wallet's state as one quiet line. A mismatch is a dot
 * and a word here; the fix opens in a compact dialog when clicked (or when an action needs the wallet).
 */
export function WalletChipStatus({ owner }: { owner: string }) {
  const problem = useWalletProblem(owner);
  const { openConnect } = useWalletUi();
  const [open, setOpen] = useState(false);
  const s = STATE[problem ?? "ok"];
  const actionable =
    problem === "wrong_account" || problem === "wrong_network" || problem === "disconnected";
  return (
    <>
      <button
        type="button"
        disabled={!actionable}
        onClick={() => (problem === "disconnected" ? openConnect() : setOpen(true))}
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5 rounded-md text-xs leading-tight",
          actionable && "hover:text-foreground underline-offset-4 hover:underline",
          (problem === "wrong_account" || problem === "wrong_network") && "text-warning",
        )}
        aria-label={`${s.text}${actionable ? " (fix)" : ""}`}
        title={actionable ? `${s.text}: click to fix` : s.text}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} aria-hidden="true" />
        {s.text}
      </button>
      <WalletFixDialog owner={owner} open={open} onOpenChange={setOpen} />
      <span className="sr-only">{shortHex(owner)}</span>
    </>
  );
}
