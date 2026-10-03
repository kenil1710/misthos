"use client";

/**
 * The wallet-dependent parts of the contributor pages. This module pulls in wagmi and viem, so pages load it
 * through ./wallet-islands only when it's needed (a click, or a returning visitor with a saved connection).
 */
import { Button } from "@/components/ui/button";
import { WalletBanner } from "@/components/web3/wallet-banner";
import { Web3Provider } from "@/components/web3/web3-provider";
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

export function PayoutBannerImpl({ expected }: { expected: string }) {
  return (
    <Web3Provider>
      <WalletBanner expected={expected} kind="payout" />
    </Web3Provider>
  );
}
