"use client";

import { formatUsdc, LimitsInput, misthosVaultAbi } from "@misthos/shared";
import { useState } from "react";
import type { Address } from "viem";
import { useWriteContract } from "wagmi";
import { UsdcInput } from "@/components/ui-kit/usdc-input";
import { LIMIT_HELP } from "@/lib/limits-help";
import { CooldownWarning } from "./owner-wallet";
import { recordTx } from "./use-owner-tx";
import { TxAction } from "./tx-action";

const FIELDS = [
  ["maxPerPayout", "Max per contributor per round", "USDC"],
  ["maxPerRound", "Max per round", "USDC"],
  ["maxPerDay", "Max per rolling 24 hours", "USDC"],
  ["autoApproveThreshold", "Your approval needed above", "USDC"],
  ["payeeCooldownHours", "New wallet cooldown", "hours"],
] as const;
type Key = (typeof FIELDS)[number][0];

/** Edit vault limits; the transaction is the change, the database just mirrors the chain afterwards. */
export function LimitsForm(p: {
  programId: string;
  vault: Address;
  owner: Address;
  current: Record<Key, string>;
}) {
  const { writeContractAsync } = useWriteContract();
  const [form, setForm] = useState(p.current);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const parsed = LimitsInput.safeParse(form);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  const changed = FIELDS.some(([k]) => form[k] !== p.current[k]);
  const l = parsed.success ? parsed.data : null;
  return (
    <div className="grid gap-6">
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {FIELDS.map(([key, label, unit]) => (
          <UsdcInput
            key={key}
            id={`limit-${key}`}
            className="grid gap-1.5"
            label={label}
            unit={unit}
            value={form[key]}
            onChange={(v) => setForm((f) => ({ ...f, [key]: v }))}
            onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
            error={touched[key] || changed ? errors[key] : null}
            hint={LIMIT_HELP[key]}
          />
        ))}
      </div>
      <CooldownWarning hours={form.payeeCooldownHours} />
      <TxAction
        owner={p.owner}
        label="Update limits"
        busyLabel="Updating…"
        disabled={!parsed.success || !changed}
        success="Vault limits updated."
        confirm={
          l
            ? {
                title: "Update the vault's limits",
                description:
                  "One transaction from your wallet. Rounds already waiting are re-checked against the new limits before they pay.",
                rows: [
                  {
                    label: "Per contributor per round",
                    value: formatUsdc(l.maxPerPayout),
                    mono: true,
                  },
                  { label: "Per round", value: formatUsdc(l.maxPerRound), mono: true },
                  { label: "Per 24 hours", value: formatUsdc(l.maxPerDay), mono: true },
                  {
                    label: "Your approval above",
                    value: formatUsdc(l.autoApproveThreshold),
                    mono: true,
                  },
                  { label: "New wallet cooldown", value: `${l.payeeCooldownHours} h`, mono: true },
                ],
                confirmLabel: "Update limits",
              }
            : undefined
        }
        steps={() => [
          {
            label: "Update limits",
            send: () =>
              writeContractAsync({
                address: p.vault,
                abi: misthosVaultAbi,
                functionName: "setLimits",
                args: [
                  {
                    maxPerPayout: l!.maxPerPayout,
                    maxPerRound: l!.maxPerRound,
                    maxPerDay: l!.maxPerDay,
                    autoApproveThreshold: l!.autoApproveThreshold,
                    payeeCooldown: BigInt(l!.payeeCooldownHours * 3600),
                  },
                ],
              }),
            record: (hash) => recordTx(`/api/owner/programs/${p.programId}/limits`, hash),
          },
        ]}
      />
    </div>
  );
}
