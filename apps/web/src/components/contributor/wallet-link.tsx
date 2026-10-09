"use client";

import { shortHex } from "@misthos/shared/money";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDisconnect, useSignMessage } from "wagmi";
import { useWalletAccount } from "@/components/web3/use-wallet-account";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chooseAccount } from "@/components/web3/choose-account";
import { WalletButton } from "@/components/web3/wallet-button";
import { useWalletUi } from "@/components/web3/web3-provider";
import { classifyWalletError } from "@/lib/wallet-errors";

const ERRORS: Record<string, string> = {
  wallet_in_use:
    "That wallet is already linked to another contributor in this program. Use a different wallet.",
  bad_signature: "The signature didn't match the connected wallet. Try again.",
  nonce_used: "This request was already used. Try again.",
  stale: "The request expired. Try again.",
  program_not_open: "This program isn't accepting contributors right now.",
  sign_in_required: "Your X session expired. Sign in with X again.",
  invalid_body: "Something in the request was off. Reload the page and try again.",
};

/**
 * Connect a wallet and sign the server-issued link message. Used for joining and for changing the payout wallet.
 */
export function WalletLink({
  programSlug,
  mode,
  cooldownHours = 0,
  currentWallet,
  onDone,
  autoOpen = false,
}: {
  programSlug: string;
  mode: "join" | "change";
  cooldownHours?: number;
  currentWallet?: string | null;
  onDone?: () => void;
  /** Open the wallet picker once if no wallet reconnects (the person just clicked "Connect"). */
  autoOpen?: boolean;
}) {
  const { address, isConnected, status, connector } = useWalletAccount();
  const { openConnect } = useWalletUi();
  const opened = useRef(false);
  useEffect(() => {
    if (autoOpen && !opened.current && status === "disconnected") {
      opened.current = true;
      openConnect();
    }
  }, [autoOpen, status, openConnect]);
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signIn?: boolean } | null>(null);
  const same =
    mode === "change" && !!currentWallet && address?.toLowerCase() === currentWallet.toLowerCase();
  // The one interruption in this flow: they asked to change wallets, but the wallet is still on the payout account.
  // Dismissed per account, and closes by itself once they switch.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const pickAnother = same && !!address && dismissedFor !== address;

  async function link() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const ch = await fetch("/api/contributor/wallet/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programSlug, address }),
      });
      const challenge = (await ch.json()) as {
        message?: string;
        nonce?: string;
        issuedAt?: string;
        error?: string;
      };
      if (!ch.ok || !challenge.message) {
        setError({
          text: ERRORS[challenge.error ?? ""] ?? "Couldn't start wallet verification. Try again.",
          signIn: ch.status === 401,
        });
        return;
      }
      const signature = await signMessageAsync({ message: challenge.message });
      const res = await fetch("/api/contributor/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programSlug,
          address,
          nonce: challenge.nonce,
          issuedAt: challenge.issuedAt,
          signature,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError({
          text: ERRORS[body.error ?? ""] ?? "Verification failed. Try again.",
          signIn: res.status === 401,
        });
        return;
      }
      if (mode === "join") {
        toast.success("You're in. Submit your first link.");
        router.push(`/c/${programSlug}`);
      } else {
        toast.success(`Payout wallet changed to ${shortHex(address)}`, {
          description: cooldownHours ? `Payouts to it start in ${cooldownHours} hours.` : undefined,
        });
        onDone?.();
      }
      router.refresh();
    } catch (e) {
      const err = classifyWalletError(e);
      setError({
        text:
          err.kind === "rejected"
            ? "You declined the signature in your wallet. Sign when you're ready; it's free."
            : err.kind === "unknown"
              ? "Something went wrong. Check your connection and try again."
              : err.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Dialog open={pickAnother} onOpenChange={(o) => !o && address && setDismissedFor(address)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick the new wallet</DialogTitle>
            <DialogDescription>
              Your wallet is on{" "}
              <span className="text-foreground font-mono text-[13px]">
                {address ? shortHex(address) : ""}
              </span>
              , which is already your payout wallet. Choose the account you want to switch to.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            <Button size="sm" onClick={() => chooseAccount(connector)}>
              Choose account in wallet
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                disconnect();
                openConnect({ fresh: true });
              }}
            >
              Use another wallet app
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (address) setDismissedFor(address);
                onDone?.();
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isConnected && address ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Wallet</span>
          <span className="font-mono text-[13px]">{shortHex(address)}</span>
          <Button variant="ghost" size="xs" onClick={() => disconnect()}>
            Use another
          </Button>
        </div>
      ) : (
        <WalletButton
          variant="default"
          label={mode === "join" ? "Connect your payout wallet" : "Connect the new wallet"}
          className="w-full sm:w-auto"
        />
      )}
      {isConnected ? (
        <Button onClick={link} disabled={busy || same} className="w-full sm:w-auto">
          {busy
            ? "Waiting for signature…"
            : same
              ? "This is already your wallet"
              : mode === "join"
                ? "Sign and join"
                : "Sign to switch wallet"}
        </Button>
      ) : null}
      <p className="text-muted-foreground text-xs leading-relaxed">
        You&apos;ll sign a message proving you control this wallet. It&apos;s free and doesn&apos;t
        send a transaction.
        {mode === "change" && cooldownHours
          ? ` For your safety, payouts to a new wallet start ${cooldownHours} hours after the change.`
          : ""}
      </p>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-danger">{error.text}</span>
          {error.signIn ? (
            <Button asChild size="xs" variant="outline">
              <a
                href={`/api/auth/x/start?next=${encodeURIComponent(mode === "join" ? `/join/${programSlug}` : `/c/${programSlug}`)}`}
              >
                Sign in with X
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
