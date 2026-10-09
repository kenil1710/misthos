"use client";

import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import {
  bitgetWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://misthos.world";

/**
 * The wallets RainbowKit lists, in order. Installed browser wallets that aren't named here still show up: wagmi
 * finds every extension through EIP-6963, and `injectedWallet` covers older ones that only set `window.ethereum`.
 * Without a WalletConnect project id only browser wallets are offered (nothing could scan a QR code).
 */
export const WALLET_GROUPS: WalletList = [
  {
    groupName: "Popular",
    wallets: [
      metaMaskWallet,
      rabbyWallet,
      coinbaseWallet,
      rainbowWallet,
      okxWallet,
      trustWallet,
      phantomWallet,
      bitgetWallet,
    ],
  },
  { groupName: "More", wallets: [injectedWallet, walletConnectWallet] },
];

/** RainbowKit's connectors. Some start SDKs (WalletConnect, MetaMask, Coinbase) as soon as they're set up. */
export function rainbowConnectors() {
  return connectorsForWallets(
    wcProjectId ? WALLET_GROUPS : [{ groupName: "Browser", wallets: [injectedWallet] }],
    {
      appName: "Misthos",
      appDescription: "Launch a campaign. AI pays your community for real work.",
      appUrl,
      appIcon: `${appUrl}/icon.svg`,
      // RainbowKit wants a project id even for browser-only wallets; it's only used for WalletConnect.
      projectId: wcProjectId || "unused",
    },
  );
}
