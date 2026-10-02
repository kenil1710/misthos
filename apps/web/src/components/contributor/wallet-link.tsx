"use client";

import { ConnectKitButton } from "connectkit";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS: Record<string, string> = {
  wallet_in_use: "That wallet is already linked to another contributor in this program.",
  bad_signature: "The signature didn't match the connected wallet. Try again.",
  nonce_used: "This request was already used. Try again.",
  stale: "The request expired. Try again.",
  program_not_open: "This program isn't accepting contributors right now.",
  sign_in_required: "Your X session expired. Sign in with X again.",
  invalid_body: "Check your GitHub username and try again.",
};

/**
 * Connect a wallet and sign the server-issued link message. Used for joining and for changing the payout wallet.
 */
export function WalletLink({
  programSlug,
  mode,
  initialGithub = "",
  showGithub = true,
}: {
  programSlug: string;
  mode: "join" | "change";
  initialGithub?: string;
  showGithub?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [github, setGithub] = useState(initialGithub);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(ERRORS[challenge.error ?? ""] ?? "Couldn't start wallet verification. Try again.");
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
          ...(showGithub ? { githubLogin: github.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setError(ERRORS[body.error ?? ""] ?? "Verification failed. Try again.");
        return;
      }
      router.push(`/c/${programSlug}`);
      router.refresh();
    } catch (e) {
      const rejected = e instanceof Error && /reject|denied/i.test(e.message);
      setError(
        rejected
          ? "Signature request was declined."
          : "Something went wrong. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {showGithub ? (
        <div className="grid max-w-sm gap-1.5">
          <Label htmlFor="github">GitHub username (optional)</Label>
          <Input
            id="github"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="octocat"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Needed if you&apos;ll submit pull requests. We match it to PR authors.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <ConnectKitButton />
        {isConnected ? (
          <Button onClick={link} disabled={busy}>
            {busy
              ? "Waiting for signature…"
              : mode === "join"
                ? "Sign and join"
                : "Sign to switch wallet"}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        You&apos;ll sign a message proving you control this wallet. It&apos;s free and doesn&apos;t
        send a transaction.
        {mode === "change" ? " Payouts to a new wallet wait out the program's cooldown." : ""}
      </p>
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
