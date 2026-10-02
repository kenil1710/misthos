"use client";

import { ConnectKitButton } from "connectkit";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  bad_signature: "That signature didn't match the connected wallet. Try again.",
  nonce_used: "This sign-in request was already used. Try again.",
  stale: "The sign-in request expired. Try again.",
  wrong_chain: "Switch your wallet to Arc and try again.",
};

/** Connect a wallet, then prove control of it with Sign-In with Ethereum (works for EOAs and smart wallets). */
export function OwnerSignIn() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        chainId,
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
          ? "Signature request was declined."
          : "Sign-in failed. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <ConnectKitButton />
      {isConnected ? (
        <Button onClick={signIn} disabled={busy}>
          {busy ? "Waiting for signature…" : "Sign in with this wallet"}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
