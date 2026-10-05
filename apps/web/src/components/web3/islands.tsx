"use client";

import { AccountChip } from "@/components/app/account-chip";
import { walletIsland } from "./island";

/** The owner sign-in flow and account chip, loaded after the page is visible. */
export const OwnerSignIn = walletIsland(
  () => import("./owner-sign-in").then((m) => m.OwnerSignIn),
  <div className="h-[196px]" aria-hidden="true" />,
);
/** Until the wallet code loads, the same chip without the wallet dot (its menu already works). */
export const WalletChipStatus = walletIsland(
  () => import("./wallet-chip").then((m) => m.WalletChipStatus),
  ({ owner, className }: { owner: string; className?: string; side?: "top" | "bottom" }) => (
    <AccountChip kind="owner" address={owner} className={className} />
  ),
);
