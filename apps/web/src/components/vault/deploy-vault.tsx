"use client";

import { formatUsdc, misthosVaultFactoryAbi, shortHex } from "@misthos/shared";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";
import { recordTx } from "./use-owner-tx";
import { TxAction } from "./tx-action";

export interface VaultLimitsArgs {
  maxPerPayout: string;
  maxPerRound: string;
  maxPerDay: string;
  autoApproveThreshold: string;
  payeeCooldown: string;
}

/** Owner deploys the program's vault through the factory, with the Misthos agent wallet as executor. */
export function DeployVault(p: {
  programId: string;
  factory: Address;
  programIdBytes32: Hex;
  owner: Address;
  agent: Address;
  limits: VaultLimitsArgs;
}) {
  const { writeContractAsync } = useWriteContract();
  const limits = {
    maxPerPayout: BigInt(p.limits.maxPerPayout),
    maxPerRound: BigInt(p.limits.maxPerRound),
    maxPerDay: BigInt(p.limits.maxPerDay),
    autoApproveThreshold: BigInt(p.limits.autoApproveThreshold),
    payeeCooldown: BigInt(p.limits.payeeCooldown),
  };
  const hours = Number(limits.payeeCooldown) / 3600;
  return (
    <TxAction
      owner={p.owner}
      label="Deploy vault"
      busyLabel="Deploying…"
      success="Vault deployed. Next: fund it with USDC."
      confirm={{
        title: "Deploy this program's vault",
        description:
          "One transaction from your wallet creates a vault that only you own. The agent can propose and send payouts inside these limits, nothing else.",
        rows: [
          { label: "Owner (you)", value: shortHex(p.owner), mono: true },
          { label: "Agent", value: shortHex(p.agent), mono: true },
          {
            label: "Per contributor per round",
            value: formatUsdc(limits.maxPerPayout),
            mono: true,
          },
          { label: "Per round", value: formatUsdc(limits.maxPerRound), mono: true },
          { label: "Per 24 hours", value: formatUsdc(limits.maxPerDay), mono: true },
          {
            label: "Your approval above",
            value: formatUsdc(limits.autoApproveThreshold),
            mono: true,
          },
          { label: "New wallet cooldown", value: `${hours} h`, mono: true },
        ],
        note: "Arc charges a small network fee in USDC. You can change the limits later.",
        confirmLabel: "Deploy vault",
      }}
      steps={() => [
        {
          label: "Deploy vault",
          send: () =>
            writeContractAsync({
              address: p.factory,
              abi: misthosVaultFactoryAbi,
              functionName: "createVault",
              args: [
                p.programIdBytes32,
                p.owner,
                p.agent,
                "0x0000000000000000000000000000000000000000",
                limits,
              ],
            }),
          record: (hash) => recordTx(`/api/owner/programs/${p.programId}/vault`, hash),
        },
      ]}
    />
  );
}
