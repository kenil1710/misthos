"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { shortHex } from "@misthos/shared/money";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDisconnect, useSwitchChain } from "wagmi";
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
 * The compact "your wallet needs one thing" dialog. Opened only when an action needs the wallet (or from the
 * wallet chip), never on its own. Every wallet prompt inside starts from a button.
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
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { openConnect } = useWalletUi();
  const router = useRouter();
  const { signIn, busy, error } = useSiweSignIn(() => router.push("/app"));

  const content =
    problem === "wrong_account" && address
      ? {
          title: "Your wallet is on another account",
          body: (
            <>
              It&apos;s on <span className="font-mono">{shortHex(address)}</span>; you&apos;re
              signed in as <span className="font-mono">{shortHex(owner)}</span>, and transactions
              here need that account.
            </>
          ),
          actions: (
            <>
              <Button onClick={() => chooseAccount(connector)}>Choose account in wallet</Button>
              <Button variant="outline" disabled={busy} onClick={signIn}>
                {busy ? "Waiting for signature…" : `Sign in as ${shortHex(address)}`}
              </Button>
              <Button variant="ghost" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </>
          ),
        }
      : problem === "wrong_network"
        ? {
            title: `Switch to ${chain.name}`,
            body: "Your wallet is on another network. One click switches, and adds the network if it's missing.",
            actions: (
              <Button
                disabled={switching}
                onClick={() =>
                  switchChainAsync({ chainId: chain.id })
                    .then(() => onOpenChange(false))
                    .catch((e) => toast.error(classifyWalletError(e).message))
                }
              >
                {switching ? "Switching…" : `Switch to ${chain.name}`}
              </Button>
            ),
          }
        : problem === "disconnected"
          ? {
              title: "Connect your wallet",
              body: (
                <>
                  Transactions are signed by <span className="font-mono">{shortHex(owner)}</span>,
                  the wallet you signed in with.
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
            <div className="flex flex-wrap gap-2">{content.actions}</div>
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
