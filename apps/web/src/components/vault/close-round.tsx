"use client";

import { formatUsdc } from "@misthos/shared/money";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";

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
