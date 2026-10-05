import { toast } from "sonner";
import { classifyWalletError } from "@/lib/wallet-errors";

/**
 * Open the wallet's own account picker, so the person can switch accounts without hunting for it. Only injected
 * wallets support this; others are told where to switch.
 */
export async function chooseAccount(
  connector: { getProvider: () => Promise<unknown> } | undefined,
) {
  try {
    const provider = (await connector?.getProvider()) as
      { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
    if (!provider?.request) throw new Error("unsupported");
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (e) {
    const err = classifyWalletError(e);
    if (err.kind === "rejected" || err.kind === "closed") return;
    toast("Switch accounts in your wallet app, then come back here.");
  }
}
