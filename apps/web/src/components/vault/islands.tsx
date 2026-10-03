"use client";

import { walletIsland } from "@/components/web3/island";

/**
 * Owner wallet components as islands (see walletIsland): pages import these, so the wallet stack loads after the
 * page is visible. Placeholders match each component's resting size.
 */
const box = (h: string, w = "w-full") => <div className={`${h} ${w}`} aria-hidden="true" />;

export const OwnerWallet = walletIsland(
  () => import("./owner-wallet").then((m) => m.OwnerWallet),
  <span className="inline-block h-7 w-40" aria-hidden="true" />,
);
export const DeployVault = walletIsland(
  () => import("./deploy-vault").then((m) => m.DeployVault),
  box("h-9", "w-64"),
);
export const FundVault = walletIsland(
  () => import("./fund-vault").then((m) => m.FundVault),
  box("h-[164px]"),
);
export const LimitsForm = walletIsland(
  () => import("./limits-form").then((m) => m.LimitsForm),
  box("h-[520px]"),
);
export const WithdrawVault = walletIsland(
  () => import("./vault-controls").then((m) => m.WithdrawVault),
  box("h-[164px]"),
);
export const PauseVault = walletIsland(
  () => import("./vault-controls").then((m) => m.PauseVault),
  box("h-9", "w-32"),
);
export const ApproveRound = walletIsland(
  () => import("./round-actions").then((m) => m.ApproveRound),
  box("h-9", "w-48"),
);
