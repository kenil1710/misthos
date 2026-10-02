/**
 * The wallets Misthos offers. Browser wallets are found through EIP-6963 announcements but only these are listed;
 * the rest of a user's extensions (Solana-first wallets, exchange wallets) stay out of the way.
 */
export const ALLOWED_WALLET_RDNS = ["io.metamask", "io.rabby", "com.coinbase.wallet"] as const;

export interface AnnouncedWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: unknown;
}

/**
 * Ask installed wallets to announce themselves and keep the allowed ones. Extensions answer synchronously during
 * dispatch, so this runs at config creation; it returns [] on the server.
 */
export function discoverAllowedWallets(): AnnouncedWallet[] {
  if (typeof window === "undefined") return [];
  const found = new Map<string, AnnouncedWallet>();
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<AnnouncedWallet>).detail;
    if (d?.info?.rdns && (ALLOWED_WALLET_RDNS as readonly string[]).includes(d.info.rdns))
      found.set(d.info.rdns, d);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  return [...found.values()];
}
