"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WalletLink } from "./wallet-link";

/** Wallet change sits behind a button: it's rare, and it starts a payout cooldown. */
export function ChangeWallet({
  programSlug,
  cooldownHours,
  currentWallet,
}: {
  programSlug: string;
  cooldownHours: number;
  currentWallet: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change payout wallet
      </Button>
    );
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Change payout wallet</p>
        <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <WalletLink
        programSlug={programSlug}
        mode="change"
        showGithub={false}
        cooldownHours={cooldownHours}
        currentWallet={currentWallet}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}
