"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { shortHex } from "@misthos/shared/money";
import { ArrowLeftRight, Network, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useSwitchChain } from "wagmi";
import { AccountChip, type AccountTone } from "@/components/app/account-chip";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useWalletProblem } from "@/components/vault/owner-wallet";
import { classifyWalletError } from "@/lib/wallet-errors";
import { chooseAccount } from "./choose-account";
import { useWalletAccount } from "./use-wallet-account";
import { useWalletUi } from "./web3-provider";

const chain = getChainConfig().chain;

/**
 * The owner's account chip with the wallet's state as a dot: green ready, amber another account or network, grey
 * not connected. Nothing here prompts the wallet on its own; every wallet request starts from a menu item.
 */
export function WalletChipStatus({
  owner,
  className,
  side,
}: {
  owner: string;
  className?: string;
  side?: "top" | "bottom";
}) {
  const problem = useWalletProblem(owner);
  const { address, connector } = useWalletAccount();
  const { openConnect } = useWalletUi();
  const { switchChainAsync } = useSwitchChain();
  const status: { tone: AccountTone; text: string } =
    problem === null
      ? { tone: "ready", text: "Wallet ready" }
      : problem === "reconnecting"
        ? { tone: "busy", text: "Reconnecting your wallet…" }
        : problem === "disconnected"
          ? { tone: "off", text: "Wallet not connected" }
          : problem === "wrong_account"
            ? {
                tone: "warning",
                text: `Wallet is on ${address ? shortHex(address.toLowerCase()) : "another account"}`,
              }
            : { tone: "warning", text: `Wallet is on another network` };
  return (
    <AccountChip
      kind="owner"
      address={owner}
      status={status}
      className={className}
      side={side}
      walletItems={
        problem === "disconnected" ? (
          <DropdownMenuItem onSelect={openConnect}>
            <Wallet className="size-4" strokeWidth={1.5} />
            Connect wallet
          </DropdownMenuItem>
        ) : (
          <>
            {problem === "wrong_network" ? (
              <DropdownMenuItem
                onSelect={() =>
                  void switchChainAsync({ chainId: chain.id }).catch((e) =>
                    toast.error(classifyWalletError(e).message),
                  )
                }
              >
                <Network className="size-4" strokeWidth={1.5} />
                Switch to {chain.name}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => void chooseAccount(connector)}>
              <ArrowLeftRight className="size-4" strokeWidth={1.5} />
              Switch account
            </DropdownMenuItem>
          </>
        )
      }
    />
  );
}
