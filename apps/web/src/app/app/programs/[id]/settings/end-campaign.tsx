"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { endProgramAction } from "../../actions";

/** End the campaign, after a confirmation that says exactly what happens. Can't be undone. */
export function EndCampaign({
  programId,
  name,
  roundLine,
}: {
  programId: string;
  name: string;
  /** e.g. "Round 3 still closes on 20 Oct and pays approved work." */
  roundLine: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button
        variant="outline"
        className="text-danger"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending ? "Ending…" : "End campaign"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`End ${name}?`}
        description="This can't be undone."
        rows={[
          { label: "New joins and submissions", value: "Stop now" },
          { label: "Current round", value: "Closes normally and pays" },
          { label: "New rounds", value: "None" },
          { label: "Leftover funds", value: "Withdraw from Treasury" },
        ]}
        note={`${roundLine} Contributors see “This campaign has ended. Thanks for contributing!”`}
        confirmLabel="End campaign"
        destructive
        onConfirm={() =>
          start(async () => {
            const res = await endProgramAction(programId);
            setOpen(false);
            if (res.ok)
              toast.success("Campaign ended. The current round still pays approved work.");
            else
              toast.error(
                res.error === "not_found" ? "Couldn't end it. Sign in again and retry." : res.error,
              );
            router.refresh();
          })
        }
      />
    </>
  );
}
