"use client";

import { formatUsdc, misthosVaultAbi, parseUsdc, shortHex } from "@misthos/shared";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useWriteContract } from "wagmi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsdcInput } from "@/components/ui-kit/usdc-input";
import { recordTx } from "./use-owner-tx";
import { TxAction } from "./tx-action";

const record =
  (programId: string, action: "withdraw" | "pause" | "unpause") => (hash: `0x${string}`) =>
    recordTx(`/api/owner/programs/${programId}/vault-control?action=${action}`, hash);

/** Owner pulls USDC out of the vault. Works even while the vault is paused. */
export function WithdrawVault(p: {
  programId: string;
  vault: Address;
  owner: Address;
  balance: string;
}) {
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState<string>(p.owner);
  const balance = BigInt(p.balance);
  let units: bigint | null = null;
  try {
    units = amount ? parseUsdc(amount) : null;
  } catch {
    units = null;
  }
  const amountError =
    amount && units === null
      ? "Enter an amount like 10 or 10.50."
      : units !== null && units > balance
        ? `The vault holds ${formatUsdc(balance)}.`
        : null;
  const toError = to && !isAddress(to) ? "That isn't a valid address." : null;
  const valid = units !== null && units > 0n && units <= balance && isAddress(to);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <UsdcInput
          id="withdraw-amount"
          className="grid gap-1.5"
          label="Amount"
          value={amount}
          onChange={setAmount}
          error={amountError}
          hint={
            <>
              Vault balance {formatUsdc(balance)}.{" "}
              {balance > 0n ? (
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4"
                  onClick={() =>
                    setAmount(formatUsdc(balance, { withSymbol: false }).replace(/,/g, ""))
                  }
                >
                  Withdraw all
                </button>
              ) : null}
            </>
          }
        />
        <div className="grid gap-1.5">
          <Label htmlFor="withdraw-to">Send to</Label>
          <Input
            id="withdraw-to"
            className="font-mono text-[13px]"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            aria-invalid={!!toError}
          />
          <p className={toError ? "text-danger text-xs" : "text-muted-foreground text-xs"}>
            {toError ?? "Defaults to your own wallet."}
          </p>
        </div>
      </div>
      <TxAction
        owner={p.owner}
        variant="outline"
        label="Withdraw"
        busyLabel="Withdrawing…"
        disabled={!valid}
        success={`Withdrew ${units ? formatUsdc(units) : ""} from the vault.`}
        confirm={{
          title: `Withdraw ${units ? formatUsdc(units) : ""}`,
          description: "Funds leave the vault right away. Rounds can only pay out what's left.",
          rows: [
            { label: "Amount", value: units ? formatUsdc(units) : "", mono: true },
            { label: "To", value: isAddress(to) ? shortHex(to) : to, mono: true },
            { label: "Left in vault", value: units ? formatUsdc(balance - units) : "", mono: true },
          ],
          confirmLabel: "Withdraw",
        }}
        steps={() => [
          {
            label: "Withdraw",
            send: () =>
              writeContractAsync({
                address: p.vault,
                abi: misthosVaultAbi,
                functionName: "withdraw",
                args: [to as Address, units!],
              }),
            record: async (hash) => {
              await record(p.programId, "withdraw")(hash);
              setAmount("");
            },
          },
        ]}
      />
    </div>
  );
}

/** Pause stops every payout, proposal and payee registration until the owner resumes. */
export function PauseVault(p: {
  programId: string;
  vault: Address;
  owner: Address;
  paused: boolean;
}) {
  const { writeContractAsync } = useWriteContract();
  const fn = p.paused ? "unpause" : "pause";
  return (
    <TxAction
      owner={p.owner}
      variant={p.paused ? "default" : "outline"}
      label={p.paused ? "Resume payouts" : "Pause vault"}
      busyLabel={p.paused ? "Resuming…" : "Pausing…"}
      success={
        p.paused
          ? "Vault resumed. Rounds can pay out again."
          : "Vault paused. Nothing can be paid until you resume."
      }
      confirm={
        p.paused
          ? {
              title: "Resume the vault?",
              description:
                "The agent can register wallets and pay rounds again, within your limits.",
              confirmLabel: "Resume",
            }
          : {
              title: "Pause the vault?",
              description:
                "No round can be proposed, approved or paid, and no new payout wallets can be registered until you resume. You can still withdraw.",
              confirmLabel: "Pause vault",
              destructive: true,
            }
      }
      steps={() => [
        {
          label: p.paused ? "Resume vault" : "Pause vault",
          send: () =>
            writeContractAsync({ address: p.vault, abi: misthosVaultAbi, functionName: fn }),
          record: record(p.programId, fn),
        },
      ]}
    />
  );
}
