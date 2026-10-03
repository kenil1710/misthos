"use client";

import { shortHex } from "@misthos/shared/money";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Connector } from "wagmi";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { classifyWalletError, WALLET_NOTICE_EVENT, type WalletError } from "@/lib/wallet-errors";
import { chain, WALLET_CHOICES } from "./wallet-config";

type Choice = (typeof WALLET_CHOICES)[number];

function connectorFor(choice: Choice, connectors: readonly Connector[]): Connector | undefined {
  if (choice.id === "com.coinbase.wallet")
    return (
      connectors.find((c) => c.id === choice.id) ??
      connectors.find((c) => c.id === "coinbaseWalletSDK")
    );
  return connectors.find((c) => c.id === choice.id);
}

/**
 * The wallet picker: MetaMask, Rabby, Coinbase Wallet and WalletConnect. Every connector promise is awaited here,
 * so a declined, closed or expired request becomes a message with a retry instead of a runtime error.
 */
export function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [pending, setPending] = useState<Choice["id"] | null>(null);
  const [error, setError] = useState<(WalletError & { retry: Choice }) | null>(null);
  const [last, setLast] = useState<Choice | null>(null);

  // Rejections nobody awaited (WalletConnect's expiring proposals): show them here, or as a toast if closed.
  useEffect(() => {
    const onNotice = (e: Event) => {
      const err = (e as CustomEvent<WalletError>).detail;
      setPending(null);
      if (last) {
        setError({ ...err, retry: last });
        onOpenChange(true);
      } else {
        toast(err.message, { action: { label: "Try again", onClick: () => onOpenChange(true) } });
      }
    };
    window.addEventListener(WALLET_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(WALLET_NOTICE_EVENT, onNotice);
  }, [last, onOpenChange]);

  async function connect(choice: Choice) {
    const connector = connectorFor(choice, connectors);
    if (!connector) return;
    setError(null);
    setPending(choice.id);
    setLast(choice);
    // WalletConnect shows its own QR modal; ours must step aside or it would block clicks on it.
    if (choice.id === "walletConnect") onOpenChange(false);
    try {
      const res = await connectAsync({ connector, chainId: chain.id });
      if (res.chainId !== chain.id) await switchChainAsync({ chainId: chain.id }).catch(() => {});
      onOpenChange(false);
    } catch (e) {
      const err = classifyWalletError(e);
      setError({ ...err, retry: choice });
      onOpenChange(true);
    } finally {
      setPending(null);
    }
  }

  const wrongNetwork = isConnected && chainId !== chain.id;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isConnected ? "Your wallet" : "Connect a wallet"}</DialogTitle>
          <DialogDescription>
            {isConnected
              ? "Connected to Misthos. Signing and transactions always ask in your wallet first."
              : `Misthos runs on ${chain.name}. Connecting is free and sends nothing.`}
          </DialogDescription>
        </DialogHeader>

        {isConnected && address ? (
          <div className="grid gap-3">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
              <span className="font-mono text-[13px]">{shortHex(address)}</span>
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
        ) : (
          <ul className="grid gap-2" aria-label="Wallets">
            {WALLET_CHOICES.map((choice) => {
              const connector = connectorFor(choice, connectors);
              if (!connector && !choice.install) return null;
              const busy = pending === choice.id;
              return (
                <li key={choice.id}>
                  {connector ? (
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => connect(choice)}
                      className="hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2.5 font-medium">
                        <WalletMark connector={connector} name={choice.name} />
                        {choice.name}
                      </span>
                      {busy ? (
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          Check your wallet
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <a
                      href={choice.install!}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:bg-muted text-muted-foreground flex w-full items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="bg-muted size-5 rounded-md" aria-hidden="true" />
                        {choice.name}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs">
                        Not installed · Get it
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error ? (
          <div
            role="alert"
            className="bg-muted/60 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm"
          >
            <span>{error.message}</span>
            <Button size="sm" variant="outline" onClick={() => connect(error.retry)}>
              Try again
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WalletMark({ connector, name }: { connector: Connector; name: string }) {
  if (connector.icon)
    // eslint-disable-next-line @next/next/no-img-element -- data: URIs announced by the wallet itself
    return <img src={connector.icon} alt="" className="size-5 rounded-md" />;
  return (
    <span
      aria-hidden="true"
      className="bg-foreground text-background flex size-5 items-center justify-center rounded-md text-[10px] font-semibold"
    >
      {name[0]}
    </span>
  );
}
