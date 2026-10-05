"use client";

/**
 * The wallet-dependent parts of the contributor pages. This module pulls in wagmi and viem, so pages load it
 * through ./wallet-islands only when it's needed (a click, or a returning visitor with a saved connection).
 */
import { Button } from "@/components/ui/button";
import { useWalletAccount } from "@/components/web3/use-wallet-account";
import { Web3Provider } from "@/components/web3/web3-provider";
import { USE_CONNECTED_WALLET_EVENT } from "@/lib/wallet-events";
import { WalletLink } from "./wallet-link";

export function JoinWalletImpl({
  programSlug,
  autoOpen,
}: {
  programSlug: string;
  autoOpen: boolean;
}) {
  return (
    <Web3Provider>
      <WalletLink programSlug={programSlug} mode="join" autoOpen={autoOpen} />
    </Web3Provider>
  );
}

export function ChangeWalletImpl({
  programSlug,
  cooldownHours,
  currentWallet,
  onClose,
}: {
  programSlug: string;
  cooldownHours: number;
  currentWallet: string | null;
  onClose: () => void;
}) {
  return (
    <Web3Provider>
      <div className="grid gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Change payout wallet</p>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <WalletLink
          programSlug={programSlug}
          mode="change"
          cooldownHours={cooldownHours}
          currentWallet={currentWallet}
          onDone={onClose}
          autoOpen
        />
      </div>
    </Web3Provider>
  );
}

/**
 * A quiet line under the payout wallet when the wallet extension is on another account. Payouts always go to the
 * linked payout wallet, so this is information, not a problem: no banner, no prompt.
 */
function PayoutWalletNote({ expected }: { expected: string }) {
  const { address, status } = useWalletAccount();
  if (status !== "connected" || !address || address.toLowerCase() === expected.toLowerCase())
    return null;
  return (
    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
      Connected wallet differs from your payout wallet.{" "}
      <button
        type="button"
        className="hover:text-foreground underline underline-offset-4"
        onClick={() => window.dispatchEvent(new Event(USE_CONNECTED_WALLET_EVENT))}
      >
        Use this wallet instead
      </button>
    </p>
  );
}

export function PayoutWalletNoteImpl({ expected }: { expected: string }) {
  return (
    <Web3Provider>
      <PayoutWalletNote expected={expected} />
    </Web3Provider>
  );
}
