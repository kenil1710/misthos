"use client";

import { shortHex } from "@misthos/shared/money";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { classifyWalletError } from "@/lib/wallet-errors";
import { useSiweSignIn } from "./owner-sign-in";
import { useWalletAccount } from "./use-wallet-account";
import { chain } from "./wallet-config";

/** Window event: "use the connected wallet as my payout wallet" (opens the change-wallet flow, which signs on click). */
export const USE_CONNECTED_WALLET_EVENT = "misthos:use-connected-wallet";

/**
 * Open the wallet's own account picker, so the person can switch back without hunting for it. Only injected
 * wallets support this; others are told where to switch.
 */
async function chooseAccount(connector: { getProvider: () => Promise<unknown> } | undefined) {
  try {
    const provider = (await connector?.getProvider()) as
      { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
    if (!provider?.request) throw new Error("unsupported");
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (e) {
    const err = classifyWalletError(e);
    if (err.kind === "rejected" || err.kind === "closed") return;
    toast("Switch accounts in your wallet app, then come back here.");
  }
}

function Banner({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div
      role="status"
      className="bg-warning-subtle text-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[color-mix(in_oklab,var(--warning)_25%,transparent)] px-4 py-3 text-sm"
    >
      <p className="min-w-0 flex-1 leading-relaxed">{children}</p>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * Calm, inline notice when the wallet extension isn't on the account this page acts for (the owner's signed-in
 * wallet, or a contributor's payout wallet), or is on another network. It never asks for a signature by itself:
 * every wallet prompt here starts from a button.
 */
export function WalletBanner({
  expected,
  kind,
  checkNetwork = kind === "owner",
}: {
  expected: string | null;
  kind: "owner" | "payout";
  checkNetwork?: boolean;
}) {
  const { address, status, chainId, connector } = useWalletAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const router = useRouter();
  const { signIn, busy, error } = useSiweSignIn(() => router.push("/app"));
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (status !== "connected" || !address) return null;

  const mismatch = !!expected && address.toLowerCase() !== expected.toLowerCase();
  if (mismatch && dismissed !== address) {
    return kind === "owner" ? (
      <Banner
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => chooseAccount(connector)}>
              Choose account in wallet
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={signIn}>
              {busy ? "Waiting for signature…" : `Sign in as ${shortHex(address)}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => disconnect()}>
              Disconnect
            </Button>
          </>
        }
      >
        You switched to <span className="font-mono text-[13px]">{shortHex(address)}</span> in your
        wallet. You&apos;re signed in as{" "}
        <span className="font-mono text-[13px]">{shortHex(expected!)}</span>, so transactions here
        need that account. Switch back, or sign in with this wallet instead.
        {error ? <span className="text-danger mt-1 block">{error}</span> : null}
      </Banner>
    ) : (
      <Banner
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => chooseAccount(connector)}>
              Switch back
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.dispatchEvent(new Event(USE_CONNECTED_WALLET_EVENT))}
            >
              Use this wallet instead
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(address)}>
              Dismiss
            </Button>
          </>
        }
      >
        You switched to <span className="font-mono text-[13px]">{shortHex(address)}</span>. This
        isn&apos;t your payout wallet (
        <span className="font-mono text-[13px]">{shortHex(expected!)}</span>). Payouts still go to
        your payout wallet. Switch back, or use this wallet instead.
      </Banner>
    );
  }
  if (checkNetwork && chainId !== chain.id)
    return (
      <Banner
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={switching}
            onClick={() =>
              switchChainAsync({ chainId: chain.id }).catch((e) =>
                toast.error(classifyWalletError(e).message),
              )
            }
          >
            {switching ? "Switching…" : `Switch to ${chain.name}`}
          </Button>
        }
      >
        Your wallet is on another network. Misthos runs on {chain.name}; one click switches (and
        adds it to your wallet if it&apos;s missing).
      </Banner>
    );
  return null;
}
