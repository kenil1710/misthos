/**
 * Wallet and connector failures, in words. Wallets reject with a mix of EIP-1193 codes, WalletConnect messages
 * ("Proposal expired", "Connection request reset") and plain strings; this maps them to something calm and
 * actionable. Nothing here ever throws.
 */

/** Window event carrying a WalletError for a rejection the guard swallowed. */
export const WALLET_NOTICE_EVENT = "misthos:wallet-notice";

export type WalletErrorKind = "expired" | "rejected" | "closed" | "pending" | "unknown";

export type WalletError = { kind: WalletErrorKind; message: string };

const text = (e: unknown): string => {
  if (!e) return "";
  if (typeof e === "string") return e;
  const o = e as { shortMessage?: unknown; message?: unknown; details?: unknown; cause?: unknown };
  return [o.shortMessage, o.message, o.details, o.cause ? text(o.cause) : ""]
    .filter((x) => typeof x === "string")
    .join(" ");
};

const code = (e: unknown): number | undefined => {
  const o = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = o?.code ?? o?.cause?.code;
  return typeof c === "number" ? c : undefined;
};

export function classifyWalletError(e: unknown): WalletError {
  const t = text(e).toLowerCase();
  if (/proposal expired|request expired|expired/.test(t))
    return { kind: "expired", message: "Connection request expired. Try again." };
  if (code(e) === -32002 || /already pending|request of type .* already pending/.test(t))
    return {
      kind: "pending",
      message:
        "Your wallet already has a request open. Finish or close it in the wallet, then try again.",
    };
  if (code(e) === 4001 || /user rejected|user denied|rejected the request|denied/.test(t))
    return { kind: "rejected", message: "You declined the request in your wallet." };
  if (/connection request reset|modal closed|closed by user|user closed|connection cancel/.test(t))
    return { kind: "closed", message: "Connection cancelled. Try again when you're ready." };
  return { kind: "unknown", message: "Couldn't connect to your wallet. Try again." };
}

/**
 * True for rejections that come from wallet connectors (WalletConnect, Coinbase SDK, injected providers) and that
 * we handle in the UI, so they shouldn't surface as runtime errors.
 */
export function isWalletNoise(reason: unknown): boolean {
  const t = text(reason).toLowerCase();
  const stack = String((reason as { stack?: unknown } | null)?.stack ?? "").toLowerCase();
  return (
    /walletconnect|@walletconnect|@reown|coinbase|proposal expired|connection request reset|user rejected|user denied|modal closed|session_request|pairing|relayer/.test(
      t,
    ) || /walletconnect|@reown|coinbase|wagmi|@metamask/.test(stack)
  );
}
