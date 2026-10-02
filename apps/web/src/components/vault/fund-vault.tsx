"use client";

import { formatUsdc, misthosVaultAbi, parseUsdc } from "@misthos/shared";
import { useState } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnerWallet } from "./owner-wallet";
import { recordTx, useOwnerTx } from "./use-owner-tx";
import { TxStatus } from "./tx-status";

/** Approve + deposit USDC (6-decimal ERC-20 interface) into the vault. */
export function FundVault(p: { programId: string; vault: Address; usdc: Address; owner: Address }) {
  const tx = useOwnerTx(p.owner);
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const { data: walletBalance } = useReadContract({
    address: p.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [p.owner],
  });
  let units: bigint | null = null;
  try {
    units = amount ? parseUsdc(amount) : null;
  } catch {
    units = null;
  }
  const valid =
    units !== null && units > 0n && (walletBalance === undefined || units <= walletBalance);
  return (
    <div className="grid gap-3">
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="fund-amount">Amount</Label>
        <div className="relative">
          <Input
            id="fund-amount"
            inputMode="decimal"
            className="pr-14 font-mono tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
            USDC
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {walletBalance !== undefined
            ? `Your wallet: ${formatUsdc(walletBalance)}`
            : "Connect your wallet to see its balance."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <OwnerWallet owner={p.owner} />
        <Button
          disabled={tx.busy || !valid}
          onClick={() =>
            tx.run([
              {
                label: "Approve USDC",
                send: () =>
                  writeContractAsync({
                    address: p.usdc,
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [p.vault, units!],
                  }),
              },
              {
                label: "Deposit",
                send: () =>
                  writeContractAsync({
                    address: p.vault,
                    abi: misthosVaultAbi,
                    functionName: "deposit",
                    args: [units!],
                  }),
                record: (hash) => recordTx(`/api/owner/programs/${p.programId}/deposit`, hash),
              },
            ])
          }
        >
          {tx.busy ? "Funding…" : "Fund vault"}
        </Button>
      </div>
      <TxStatus status={tx.status} error={tx.error} />
    </div>
  );
}
