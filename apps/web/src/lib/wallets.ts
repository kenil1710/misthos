/**
 * Whether this browser connected a wallet here before, read from wagmi's saved state. Cheap (no wallet code), so
 * pages can decide whether to load the wallet stack right away to reconnect silently.
 */
export function hadWalletBefore(): boolean {
  try {
    const raw = localStorage.getItem("wagmi.store");
    if (!raw) return false;
    const s = JSON.parse(raw) as { state?: { current?: string | null } };
    return !!s.state?.current;
  } catch {
    return false;
  }
}
