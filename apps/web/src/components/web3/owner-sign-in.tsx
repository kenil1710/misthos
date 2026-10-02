"use client";

import { getChainConfig, shortHex } from "@misthos/shared";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WalletButton } from "./wallet-button";

const chain = getChainConfig().chain;

const ERRORS: Record<string, string> = {
  bad_signature: "That signature didn't match the connected wallet. Try again.",
  nonce_used: "This sign-in request was already used. Try again.",
  stale: "The sign-in request expired. Try again.",
  wrong_chain: `Switch your wallet to ${chain.name} and try again.`,
};

/** Connect a wallet, then prove control of it with Sign-In with Ethereum (works for EOAs and smart wallets). */
export function OwnerSignIn() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrongChain = isConnected && chainId !== chain.id;

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const nonceRes = await fetch("/api/auth/siwe/nonce", { method: "POST" });
      if (!nonceRes.ok) throw new Error("nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };
      const message = createSiweMessage({
        address,
        chainId: chain.id,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to Misthos to manage your contributor programs.",
        issuedAt: new Date(),
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(ERRORS[body.error ?? ""] ?? "Sign-in failed. Try again.");
        return;
      }
      router.refresh();
    } catch (e) {
      const rejected = e instanceof Error && /reject|denied/i.test(e.message);
      setError(
        rejected
          ? "You declined the signature in your wallet. Sign in again when you're ready."
          : "Sign-in failed. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ol className="grid gap-5">
      <Step n={1} done={isConnected} title="Connect your wallet">
        {isConnected && address ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-[13px]">{shortHex(address)}</span>
            <Button variant="ghost" size="sm" onClick={() => disconnect()}>
              Use another wallet
            </Button>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              The wallet that will own your programs and their vaults.
            </p>
            <WalletButton variant="default" />
          </>
        )}
      </Step>
      <Step n={2} done={false} title="Sign a message" disabled={!isConnected}>
        <p className="text-muted-foreground text-sm">
          A free signature that proves the wallet is yours. It doesn&apos;t send a transaction.
        </p>
        {wrongChain ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
              {switching ? "Switching…" : `Switch to ${chain.name}`}
            </Button>
            <span className="text-warning text-sm">Your wallet is on another network.</span>
          </div>
        ) : (
          <Button onClick={signIn} disabled={!isConnected || busy}>
            {busy ? "Waiting for signature…" : "Sign in"}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
      </Step>
    </ol>
  );
}

function Step({
  n,
  title,
  done,
  disabled = false,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn("flex gap-4", disabled && "opacity-50")}
     
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
          done && "bg-foreground text-background border-foreground",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
      </span>
      <div className="grid min-w-0 flex-1 gap-2.5">
        <p className="leading-6 font-medium">{title}</p>
        {disabled ? null : children}
      </div>
    </li>
  );
}
