"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Hex } from "viem";
import { usePublicClient } from "wagmi";
import { useWalletAccount } from "@/components/web3/use-wallet-account";
import { humanizeTxError } from "@/lib/tx-errors";

const chain = getChainConfig().chain;
export const explorerTxUrl = (hash: string) => `${chain.blockExplorers!.default.url}/tx/${hash}`;

export type TxStep = {
  label: string;
  send: () => Promise<Hex>;
  /** Server verification of the confirmed transaction (records it in the database and audit log). */
  record?: (hash: Hex) => Promise<void>;
};

export type StepState = "idle" | "wallet" | "pending" | "recording" | "done" | "failed";
export interface StepView {
  label: string;
  state: StepState;
  hash?: Hex;
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session expired. Sign in again to continue.");
  }
}

/**
 * Owner transactions, one step at a time: wallet prompt → pending on Arc (with explorer link) → server check →
 * confirmed. Every failure becomes one sentence and a toast; a failed run can be retried from the failed step.
 */
export function useOwnerTx(ownerAddress: string) {
  const { address, chainId, isConnected, status } = useWalletAccount();
  const client = usePublicClient({ chainId: chain.id });
  const router = useRouter();
  const [steps, setSteps] = useState<StepView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useRef<{
    steps: TxStep[];
    success: string;
    from: number;
    hashes: (Hex | undefined)[];
  } | null>(null);

  const wrongWallet = isConnected && address?.toLowerCase() !== ownerAddress.toLowerCase();
  const wrongChain = isConnected && chainId !== chain.id;
  const ready = status === "connected" && !wrongWallet && !wrongChain;

  const patch = (i: number, s: Partial<StepView>) =>
    setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, ...s } : x)));

  const exec = useCallback(
    async (txSteps: TxStep[], success: string, from: number, hashes: (Hex | undefined)[]) => {
      setError(null);
      setExpired(false);
      setBusy(true);
      last.current = { steps: txSteps, success, from, hashes };
      let i = from;
      try {
        for (; i < txSteps.length; i++) {
          const step = txSteps[i]!;
          // A step whose transaction already confirmed only needs its server check retried.
          let hash = hashes[i];
          if (!hash) {
            patch(i, { state: "wallet", hash: undefined });
            hash = await step.send();
            hashes[i] = hash;
            patch(i, { state: "pending", hash });
            const receipt = await client!.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error(`${step.label} was reverted on Arc.`);
          }
          if (step.record) {
            patch(i, { state: "recording", hash });
            await step.record(hash);
          }
          patch(i, { state: "done", hash });
        }
        const finalHash = hashes[txSteps.length - 1];
        toast.success(success, {
          action: finalHash
            ? { label: "View", onClick: () => window.open(explorerTxUrl(finalHash), "_blank") }
            : undefined,
        });
        last.current = null;
        router.refresh();
      } catch (e) {
        if (e instanceof SessionExpiredError) setExpired(true);
        const msg = e instanceof SessionExpiredError ? e.message : humanizeTxError(e);
        patch(i, { state: "failed" });
        last.current = { steps: txSteps, success, from: i, hashes };
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [client, router],
  );

  function run(txSteps: TxStep[], success: string) {
    if (!ready) return;
    setSteps(txSteps.map((s) => ({ label: s.label, state: "idle" })));
    void exec(txSteps, success, 0, []);
  }

  function retry() {
    const l = last.current;
    if (l && ready) void exec(l.steps, l.success, l.from, l.hashes);
  }

  function reset() {
    setSteps([]);
    setError(null);
    last.current = null;
  }

  return {
    run,
    retry,
    reset,
    busy,
    steps,
    error,
    expired,
    ready,
    wrongWallet,
    wrongChain,
    isConnected,
  };
}

/** POST a tx hash to a verifying endpoint; throws with the server's message on failure. */
export async function recordTx(url: string, hash: Hex) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: hash }),
  });
  if (res.status === 401) throw new SessionExpiredError();
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok)
    throw new Error(body.error ?? "The transaction confirmed, but Misthos couldn't record it.");
}
