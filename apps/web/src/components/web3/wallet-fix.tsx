"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { shortHex } from "@misthos/shared/money";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWalletProblem } from "@/components/vault/owner-wallet";
import { classifyWalletError } from "@/lib/wallet-errors";
import { useSiweSignIn } from "./owner-sign-in";
import { useWalletAccount } from "./use-wallet-account";
import { chooseAccount } from "./choose-account";
import { useWalletUi } from "./web3-provider";

const chain = getChainConfig().chain;

/**
 * The compact "your wallet needs one thing" dialog. Opened only when an action needs the owner wallet, never from
 * browsing. Every wallet prompt inside starts from a button; disconnecting lives in the account menu.
 */
export function WalletFixDialog({
  owner,
  open,
  onOpenChange,
}: {
  owner: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const problem = useWalletProblem(owner);
  const { address, connector } = useWalletAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { openConnect } = useWalletUi();
  const router = useRouter();
  const { signIn, busy, error } = useSiweSignIn(() => router.push("/app"));

  const content =
    problem === "wrong_account" && address
      ? {
          title: "Switch to your owner wallet",
          body: (
            <>
              This action needs <span className="text-foreground font-mono">{shortHex(owner)}</span>
              .
            </>
          ),
          actions: (
            <>
              <Button onClick={() => chooseAccount(connector)}>Open wallet</Button>
              <button
                type="button"
                disabled={busy}
                onClick={signIn}
                className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline disabled:opacity-50"
              >
                {busy ? "Waiting for signature…" : `Use ${shortHex(address.toLowerCase())} instead`}
              </button>
            </>
          ),
        }
      : problem === "wrong_network"
        ? {
            title: `Switch to ${chain.name}`,
            body: <>This action needs your wallet on {chain.name}.</>,
            actions: (
              <Button
                disabled={switching}
                onClick={() =>
                  switchChainAsync({ chainId: chain.id })
                    .then(() => onOpenChange(false))
                    .catch((e) => toast.error(classifyWalletError(e).message))
                }
              >
                {switching ? "Switching…" : "Switch network"}
              </Button>
            ),
          }
        : problem === "disconnected"
          ? {
              title: "Connect your owner wallet",
              body: (
                <>
                  This action needs{" "}
                  <span className="text-foreground font-mono">{shortHex(owner)}</span>.
                </>
              ),
              actions: (
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    openConnect();
                  }}
                >
                  Connect wallet
                </Button>
              ),
            }
          : null;

  return (
    <Dialog open={open && content !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {content ? (
          <>
            <DialogHeader>
              <DialogTitle>{content.title}</DialogTitle>
              <DialogDescription>{content.body}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-4">{content.actions}</div>
            {error ? (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
