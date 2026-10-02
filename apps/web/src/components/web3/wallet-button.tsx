"use client";

import { shortHex } from "@misthos/shared";
import { ConnectKitButton } from "connectkit";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** ConnectKit's modal behind a button from our own design system. */
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
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, address, chain, unsupported }) => (
        <Button
          type="button"
          variant={variant}
          size={size}
          onClick={show}
          className={cn("gap-2", className)}
        >
          <Wallet className="size-4" strokeWidth={1.5} aria-hidden="true" />
          {isConnected && address ? (
            <span className="font-mono text-[13px]">
              {unsupported || !chain ? "Wrong network" : shortHex(address)}
            </span>
          ) : (
            label
          )}
        </Button>
      )}
    </ConnectKitButton.Custom>
  );
}
