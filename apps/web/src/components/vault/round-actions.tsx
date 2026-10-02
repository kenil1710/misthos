"use client";

import { misthosVaultAbi } from "@misthos/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { OwnerWallet } from "./owner-wallet";
import { recordTx, useOwnerTx } from "./use-owner-tx";
import { TxStatus } from "./tx-status";

/** Owner signs approveRound for a proposed round above the auto-approve threshold; the agent then executes it. */
export function ApproveRound(p: {
  roundId: string;
  vault: Address;
  roundIdBytes32: Hex;
  owner: Address;
}) {
  const tx = useOwnerTx(p.owner);
  const { writeContractAsync } = useWriteContract();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <OwnerWallet owner={p.owner} />
        <Button
          disabled={tx.busy}
          onClick={() =>
            tx.run([
              {
                label: "Approve round",
                send: () =>
                  writeContractAsync({
                    address: p.vault,
                    abi: misthosVaultAbi,
                    functionName: "approveRound",
                    args: [p.roundIdBytes32],
                  }),
                record: (hash) => recordTx(`/api/owner/rounds/${p.roundId}/approved`, hash),
              },
            ])
          }
        >
          {tx.busy ? "Approving…" : "Approve round"}
        </Button>
      </div>
      <TxStatus status={tx.status} error={tx.error} />
    </div>
  );
}

/** Close the current round now (no transaction: the agent closes, re-checks and proposes). */
export function CloseRoundNow({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="grid gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await fetch(`/api/owner/rounds/${roundId}/close`, { method: "POST" });
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          setMsg(
            body.ok
              ? "Closing. The agent is re-checking approved work and preparing payouts."
              : (body.error ?? "Couldn't close the round."),
          );
          setBusy(false);
          router.refresh();
        }}
      >
        Close round now
      </Button>
      {msg ? <p className="text-muted-foreground text-xs">{msg}</p> : null}
    </div>
  );
}
