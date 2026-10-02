"use client";

import { formatUsdc, misthosVaultAbi } from "@misthos/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { recordTx } from "./use-owner-tx";
import { TxAction } from "./tx-action";

/** Owner signs approveRound for a proposed round above the auto-approve threshold; the agent then executes it. */
export function ApproveRound(p: {
  roundId: string;
  roundNumber: number;
  vault: Address;
  roundIdBytes32: Hex;
  owner: Address;
  total: string;
  payoutCount: number;
}) {
  const { writeContractAsync } = useWriteContract();
  return (
    <TxAction
      owner={p.owner}
      label="Approve round"
      busyLabel="Approving…"
      success={`Round ${p.roundNumber} approved. The agent is sending the payouts.`}
      confirm={{
        title: `Approve round ${p.roundNumber}`,
        description:
          "Your approval lets the agent send these payouts from the vault. Each one is still checked against your limits when it's sent.",
        rows: [
          { label: "Total", value: formatUsdc(BigInt(p.total)), mono: true },
          { label: "Payouts", value: String(p.payoutCount), mono: true },
        ],
        confirmLabel: `Approve ${formatUsdc(BigInt(p.total))}`,
      }}
      steps={() => [
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
      ]}
    />
  );
}

/** Close the current round now (no transaction: the agent closes, re-checks and proposes). */
export function CloseRoundNow({
  roundId,
  roundNumber,
  approvedTotal,
  approvedCount,
  threshold,
}: {
  roundId: string;
  roundNumber: number;
  approvedTotal: string;
  approvedCount: number;
  threshold: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const total = BigInt(approvedTotal);
  async function close() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/rounds/${roundId}/close`, { method: "POST" });
      if (res.status === 401) {
        toast.error("Your session expired. Sign in again to continue.");
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok)
        toast.success(`Closing round ${roundNumber}`, {
          description: "The agent is re-checking approved work and preparing payouts.",
        });
      else toast.error(body.error ?? "Couldn't close the round.");
      router.refresh();
    } catch {
      toast.error("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  const needsApproval = threshold !== null && total > BigInt(threshold);
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        {busy ? "Closing…" : "Close round now"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Close round ${roundNumber} now?`}
        description="Contributors can't submit to this round after it closes. The next round opens right away."
        rows={[
          { label: "Approved so far", value: formatUsdc(total), mono: true },
          { label: "Approved items", value: String(approvedCount), mono: true },
        ]}
        note={
          approvedCount === 0
            ? "Nothing is approved yet, so nothing will be paid."
            : needsApproval
              ? "The agent re-checks each item, then proposes the round. It's above your approval threshold, so it waits for your signature before anything is paid."
              : "The agent re-checks each item, then pays the round automatically within your limits."
        }
        confirmLabel="Close round"
        onConfirm={close}
      />
    </>
  );
}
