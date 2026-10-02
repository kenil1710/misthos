"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRow } from "@/components/ui-kit/confirm-dialog";
import { OwnerWallet } from "./owner-wallet";
import { TxProgress } from "./tx-progress";
import { useOwnerTx, type TxStep } from "./use-owner-tx";

export interface ConfirmSpec {
  title: string;
  description?: React.ReactNode;
  rows?: ConfirmRow[];
  note?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * The bottom of every on-chain card: wallet readiness (with its fix), the action button, a confirmation dialog for
 * anything that moves money, and step-by-step progress.
 */
export function TxAction({
  owner,
  label,
  busyLabel,
  steps,
  success,
  confirm,
  disabled = false,
  disabledReason,
  variant = "default",
}: {
  owner: string;
  label: string;
  busyLabel: string;
  steps: () => TxStep[];
  success: string;
  confirm?: ConfirmSpec;
  disabled?: boolean;
  /** Shown under a disabled button so it's never a mystery why it can't be pressed. */
  disabledReason?: string;
  variant?: "default" | "outline" | "destructive";
}) {
  const tx = useOwnerTx(owner);
  const [open, setOpen] = useState(false);
  const start = () => tx.run(steps(), success);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={variant}
          disabled={disabled || tx.busy || !tx.ready}
          onClick={() => (confirm ? setOpen(true) : start())}
        >
          {tx.busy ? busyLabel : label}
        </Button>
        <OwnerWallet owner={owner} compact />
      </div>
      {disabled && !tx.busy && disabledReason ? (
        <p className="text-muted-foreground -mt-1 text-xs">{disabledReason}</p>
      ) : null}
      <TxProgress
        steps={tx.steps}
        error={tx.error}
        expired={tx.expired}
        busy={tx.busy}
        onRetry={tx.retry}
      />
      {confirm ? (
        <ConfirmDialog open={open} onOpenChange={setOpen} onConfirm={start} {...confirm} />
      ) : null}
    </div>
  );
}
