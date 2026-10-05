"use client";

import { walletIsland } from "./island";

/** The owner sign-in flow and wallet chip, loaded after the page is visible. */
export const OwnerSignIn = walletIsland(
  () => import("./owner-sign-in").then((m) => m.OwnerSignIn),
  <div className="h-[196px]" aria-hidden="true" />,
);
export const WalletChipStatus = walletIsland(
  () => import("./wallet-chip").then((m) => m.WalletChipStatus),
  <span className="block h-4" aria-hidden="true" />,
);
