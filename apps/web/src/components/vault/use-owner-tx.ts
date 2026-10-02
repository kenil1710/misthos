"use client";

import { getChainConfig } from "@misthos/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";

const chain = getChainConfig().chain;

export type TxStep = {
  label: string;
  send: () => Promise<Hex>;
  record?: (hash: Hex) => Promise<void>;
};

/**
 * Run owner transactions in order: check wallet + network, send, wait for the receipt, then let the server verify
 * the event. Errors come back as sentences, never raw RPC dumps.
 */
export function useOwnerTx(ownerAddress: string) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const client = usePublicClient({ chainId: chain.id });
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrongWallet = isConnected && address?.toLowerCase() !== ownerAddress.toLowerCase();

  async function run(steps: TxStep[]) {
    setError(null);
    if (!isConnected) return setError("Connect your wallet first.");
    if (wrongWallet)
      return setError(
        `Switch to the wallet you signed in with (${ownerAddress.slice(0, 6)}…${ownerAddress.slice(-4)}).`,
      );
    setBusy(true);
    try {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      for (const step of steps) {
        setStatus(`${step.label}: confirm in your wallet…`);
        const hash = await step.send();
        setStatus(`${step.label}: waiting for Arc…`);
        const receipt = await client!.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${step.label} reverted on-chain.`);
        if (step.record) {
          setStatus(`${step.label}: recording…`);
          await step.record(hash);
        }
      }
      setStatus(null);
      router.refresh();
    } catch (e) {
      const msg =
        (e as { shortMessage?: string; message?: string }).shortMessage ??
        (e as Error).message ??
        "Something went wrong.";
      setError(
        /reject|denied/i.test(msg)
          ? "Transaction was declined in your wallet."
          : msg.split("\n")[0]!,
      );
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, status, error, wrongWallet, isConnected };
}

/** POST a tx hash to a verifying endpoint; throws with the server's message on failure. */
export async function recordTx(url: string, hash: Hex) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: hash }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok)
    throw new Error(body.error ?? "The server couldn't verify that transaction.");
}
