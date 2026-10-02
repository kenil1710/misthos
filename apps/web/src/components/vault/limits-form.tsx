"use client";

import { LimitsInput, misthosVaultAbi } from "@misthos/shared";
import { ConnectKitButton } from "connectkit";
import { useState } from "react";
import type { Address } from "viem";
import { useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordTx, useOwnerTx } from "./use-owner-tx";
import { TxStatus } from "./tx-status";

const FIELDS = [
  ["maxPerPayout", "Max per contributor per round", "USDC"],
  ["maxPerRound", "Max per round", "USDC"],
  ["maxPerDay", "Max per rolling 24 hours", "USDC"],
  ["autoApproveThreshold", "Rounds above this need your approval", "USDC"],
  ["payeeCooldownHours", "New wallet cooldown", "hours"],
] as const;

/** Edit vault limits; the transaction is the change, the database just mirrors the chain afterwards. */
export function LimitsForm(p: {
  programId: string;
  vault: Address;
  owner: Address;
  current: Record<(typeof FIELDS)[number][0], string>;
}) {
  const tx = useOwnerTx(p.owner);
  const { writeContractAsync } = useWriteContract();
  const [form, setForm] = useState(p.current);
  const parsed = LimitsInput.safeParse(form);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(([key, label, unit]) => (
          <div key={key} className="grid gap-1.5">
            <Label htmlFor={`limit-${key}`}>{label}</Label>
            <div className="relative">
              <Input
                id={`limit-${key}`}
                inputMode="decimal"
                className="pr-16 font-mono tabular-nums"
                value={form[key]}
                aria-invalid={!!errors[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
                {unit}
              </span>
            </div>
            {errors[key] ? <p className="text-danger text-xs">{errors[key]}</p> : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ConnectKitButton />
        <Button
          disabled={tx.busy || !parsed.success}
          onClick={() => {
            if (!parsed.success) return;
            const l = parsed.data;
            tx.run([
              {
                label: "Update limits",
                send: () =>
                  writeContractAsync({
                    address: p.vault,
                    abi: misthosVaultAbi,
                    functionName: "setLimits",
                    args: [
                      {
                        maxPerPayout: l.maxPerPayout,
                        maxPerRound: l.maxPerRound,
                        maxPerDay: l.maxPerDay,
                        autoApproveThreshold: l.autoApproveThreshold,
                        payeeCooldown: BigInt(l.payeeCooldownHours * 3600),
                      },
                    ],
                  }),
                record: (hash) => recordTx(`/api/owner/programs/${p.programId}/limits`, hash),
              },
            ]);
          }}
        >
          {tx.busy ? "Updating…" : "Update limits on-chain"}
        </Button>
      </div>
      <TxStatus status={tx.status} error={tx.error} />
    </div>
  );
}
