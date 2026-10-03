"use client";

import { shortHex } from "@misthos/shared/money";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWalletAccount } from "./use-wallet-account";
import { chain } from "./wallet-config";
import { useWalletUi } from "./web3-provider";

/** Opens the wallet picker (or, once connected, the account panel) from a button in our own design system. */
export function WalletButton({
  label = "Connect wallet",
  size = "default",
  variant = "outline",
  className,
}: {
  label?: string;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  const { openConnect } = useWalletUi();
  const { address, isConnected, chainId } = useWalletAccount();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={openConnect}
      className={cn("gap-2", className)}
    >
      <Wallet className="size-4" strokeWidth={1.5} aria-hidden="true" />
      {isConnected && address ? (
        <span className="font-mono text-[13px]">
          {chainId !== chain.id ? "Wrong network" : shortHex(address)}
        </span>
      ) : (
        label
      )}
    </Button>
  );
}
