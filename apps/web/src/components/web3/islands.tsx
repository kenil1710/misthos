"use client";

import { walletIsland } from "./island";

/** The owner shell's wallet notice and the sign-in flow, loaded after the page is visible. */
export const WalletBanner = walletIsland(() =>
  import("./wallet-banner").then((m) => m.WalletBanner),
);
export const OwnerSignIn = walletIsland(
  () => import("./owner-sign-in").then((m) => m.OwnerSignIn),
  <div className="h-[196px]" aria-hidden="true" />,
);
export const WalletChipStatus = walletIsland(
  () => import("./wallet-chip").then((m) => m.WalletChipStatus),
  <span className="block h-4" aria-hidden="true" />,
);
