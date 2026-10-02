"use client";

import { shortHex } from "@misthos/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletButton } from "@/components/web3/wallet-button";

const ERRORS: Record<string, string> = {
  wallet_in_use:
    "That wallet is already linked to another contributor in this program. Use a different wallet.",
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
  cooldownHours = 0,
  currentWallet,
  onDone,
}: {
  programSlug: string;
  mode: "join" | "change";
  initialGithub?: string;
  showGithub?: boolean;
  cooldownHours?: number;
  currentWallet?: string | null;
  onDone?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [github, setGithub] = useState(initialGithub);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signIn?: boolean } | null>(null);
  const same =
    mode === "change" && !!currentWallet && address?.toLowerCase() === currentWallet.toLowerCase();

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
          ...(showGithub ? { githubLogin: github.trim() } : {}),
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
      const rejected = e instanceof Error && /reject|denied/i.test(e.message);
      setError({
        text: rejected
          ? "You declined the signature in your wallet. Sign when you're ready; it's free."
          : "Something went wrong. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
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
      {showGithub && isConnected ? (
        <div className="grid gap-1.5">
          <Label htmlFor="github">
            GitHub username <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="github"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="octocat"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Only needed if you&apos;ll submit pull requests or commits.
          </p>
        </div>
      ) : null}
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
