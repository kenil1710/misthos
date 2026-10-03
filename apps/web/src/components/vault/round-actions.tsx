"use client";

import { formatUsdc } from "@misthos/shared/money";
import { misthosVaultAbi } from "@misthos/shared/abi";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";
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
      label={`Approve ${formatUsdc(BigInt(p.total))}`}
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
