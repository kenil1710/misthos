"use client";

import { formatUsdc, parseUsdc, shortHex } from "@misthos/shared/money";
import { getChainConfig } from "@misthos/shared/chains";
import { misthosVaultAbi } from "@misthos/shared/abi";
import { useState } from "react";
import { erc20Abi, type Address } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { UsdcInput } from "@/components/ui-kit/usdc-input";
import { recordTx } from "./use-owner-tx";
import { TxAction } from "./tx-action";

const faucet = getChainConfig().faucetUrl;

/** Approve + deposit USDC (6-decimal ERC-20 interface) into the vault. */
export function FundVault(p: {
  programId: string;
  vault: Address;
  usdc: Address;
  owner: Address;
  /** Quick picks (base-unit strings), e.g. one round at the per-round cap. */
  suggestions?: { label: string; amount: string }[];
  size?: "default" | "lg";
}) {
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const { data: walletBalance, refetch } = useReadContract({
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
  const tooMuch = units !== null && walletBalance !== undefined && units > walletBalance;
  const error =
    amount && units === null
      ? "Enter an amount like 25 or 25.50."
      : tooMuch
        ? "That's more than your wallet holds."
        : null;
  const valid = units !== null && units > 0n && !tooMuch;
  return (
    <div className="grid gap-4">
      {p.suggestions?.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested amounts">
          {p.suggestions.map((s) => {
            const value = formatUsdc(BigInt(s.amount), { withSymbol: false }).replace(/,/g, "");
            const active = amount === value;
            return (
              <button
                key={s.label}
                type="button"
                aria-pressed={active}
                onClick={() => setAmount(value)}
                className={
                  active
                    ? "border-brand bg-brand-subtle text-brand rounded-full border px-3 py-1.5 text-xs font-medium"
                    : "hover:bg-muted rounded-full border px-3 py-1.5 text-xs"
                }
              >
                {s.label} · <span className="mono-num">{formatUsdc(BigInt(s.amount))}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <UsdcInput
        id="fund-amount"
        label="Amount to deposit"
        value={amount}
        onChange={setAmount}
        error={error}
        hint={
          walletBalance !== undefined ? (
            <>
              Your wallet has {formatUsdc(walletBalance)}.{" "}
              {walletBalance > 0n ? (
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4"
                  onClick={() =>
                    setAmount(formatUsdc(walletBalance, { withSymbol: false }).replace(/,/g, ""))
                  }
                >
                  Use max
                </button>
              ) : null}
              {faucet && (walletBalance === 0n || tooMuch) ? (
                <>
                  {" "}
                  Need test USDC?{" "}
                  <a
                    href={faucet}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground underline underline-offset-4"
                  >
                    Circle faucet
                  </a>
                </>
              ) : null}
            </>
          ) : (
            "Connect your wallet to see its balance."
          )
        }
      />
      <TxAction
        size={p.size}
        owner={p.owner}
        label="Fund vault"
        busyLabel="Funding…"
        disabled={!valid}
        disabledReason={
          !amount ? "Enter an amount to deposit." : error ? "Fix the amount above." : undefined
        }
        success={`Deposited ${units ? formatUsdc(units) : ""} into the vault.`}
        confirm={{
          title: `Deposit ${units ? formatUsdc(units) : ""}`,
          description: "Two wallet prompts: allow the vault to take this amount, then deposit it.",
          rows: [
            { label: "Amount", value: units ? formatUsdc(units) : "", mono: true },
            { label: "From", value: shortHex(p.owner), mono: true },
            { label: "To vault", value: shortHex(p.vault), mono: true },
          ],
          note: "You can withdraw unused funds at any time, even while the vault is paused.",
          confirmLabel: "Deposit",
        }}
        steps={() => [
          {
            label: "Allow the vault to take USDC",
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
            record: async (hash) => {
              await recordTx(`/api/owner/programs/${p.programId}/deposit`, hash);
              setAmount("");
              void refetch();
            },
          },
        ]}
      />
    </div>
  );
}
