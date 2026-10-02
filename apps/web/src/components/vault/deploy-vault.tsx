"use client";

import { misthosVaultFactoryAbi } from "@misthos/shared";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { OwnerWallet } from "./owner-wallet";
import { recordTx, useOwnerTx } from "./use-owner-tx";
import { TxStatus } from "./tx-status";

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
  const tx = useOwnerTx(p.owner);
  const { writeContractAsync } = useWriteContract();
  const limits = {
    maxPerPayout: BigInt(p.limits.maxPerPayout),
    maxPerRound: BigInt(p.limits.maxPerRound),
    maxPerDay: BigInt(p.limits.maxPerDay),
    autoApproveThreshold: BigInt(p.limits.autoApproveThreshold),
    payeeCooldown: BigInt(p.limits.payeeCooldown),
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <OwnerWallet owner={p.owner} />
        <Button
          disabled={tx.busy || !tx.isConnected}
          onClick={() =>
            tx.run([
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
            ])
          }
        >
          {tx.busy ? "Deploying…" : "Deploy vault"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        You own the vault. The Misthos agent can only propose and execute payouts inside the limits
        below, and you can pause it or withdraw at any time.
      </p>
      <TxStatus status={tx.status} error={tx.error} />
    </div>
  );
}
