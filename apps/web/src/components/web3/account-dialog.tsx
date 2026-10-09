"use client";

import { shortHex } from "@misthos/shared/money";
import { toast } from "sonner";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { classifyWalletError } from "@/lib/wallet-errors";
import { chain } from "./wallet-config";

/** The connected wallet: address, network (with a one-click switch to Arc Testnet) and disconnect. */
export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { address, chainId, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const wrongNetwork = chainId !== chain.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Your wallet</DialogTitle>
          <DialogDescription>
            Connected to Misthos{connector?.name ? ` with ${connector.name}` : ""}. Signing and
            transactions always ask in your wallet first.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
            <span className="font-mono text-[13px]">{address ? shortHex(address) : "…"}</span>
            <span className={wrongNetwork ? "text-warning" : "text-muted-foreground"}>
              {wrongNetwork ? "Other network" : chain.name}
            </span>
          </div>
          {wrongNetwork ? (
            <Button
              disabled={switching}
              onClick={() =>
                switchChainAsync({ chainId: chain.id }).catch((e) =>
                  toast.error(classifyWalletError(e).message),
                )
              }
            >
              {switching ? "Switching…" : `Switch to ${chain.name}`}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              disconnect();
              onOpenChange(false);
            }}
          >
            Disconnect
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
