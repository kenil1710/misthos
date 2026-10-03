"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { discoverAllowedWallets } from "@/lib/wallets";

export const chain = getChainConfig().chain;
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** The four wallets Misthos offers, in the order shown. `rdns` matches EIP-6963 announcements. */
export const WALLET_CHOICES = [
  { id: "io.metamask", name: "MetaMask", install: "https://metamask.io/download/" },
  { id: "io.rabby", name: "Rabby", install: "https://rabby.io/" },
  {
    id: "com.coinbase.wallet",
    name: "Coinbase Wallet",
    install: "https://www.coinbase.com/wallet",
  },
  { id: "walletConnect", name: "WalletConnect", install: null },
] as const;

function makeConfig() {
  const browser = typeof window !== "undefined";
  // Allowed browser wallets, each as its own connector. Found synchronously so a reload can reconnect at once.
  const found = discoverAllowedWallets();
  const extensions = found.map((w) =>
    injected({
      target: () => ({
        id: w.info.rdns,
        name: w.info.name,
        icon: w.info.icon,
        provider: w.provider as never,
      }),
    }),
  );
  const hasCoinbaseExtension = found.some((w) => w.info.rdns === "com.coinbase.wallet");
  return createConfig({
    chains: [chain],
    transports: { [chain.id]: http() },
    // Restore the saved connection once, in an effect (see Web3Provider), not during render.
    ssr: true,
    multiInjectedProviderDiscovery: false,
    connectors: [
      ...extensions,
      // The SDKs below are only downloaded when someone picks them.
      ...(browser && !hasCoinbaseExtension
        ? [coinbaseWallet({ appName: "Misthos", preference: { options: "all" } })]
        : []),
      ...(browser && wcProjectId
        ? [
            walletConnect({
              projectId: wcProjectId,
              showQrModal: true,
              metadata: {
                name: "Misthos",
                description: "Contributor payroll, run by an agent you can audit.",
                url: process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
                icons: [],
              },
            }),
          ]
        : []),
    ],
  });
}

let browserConfig: ReturnType<typeof makeConfig> | undefined;
let browserQueryClient: QueryClient | undefined;

/** One config and one query client per tab, shared by every wallet island on the page. */
export function getWalletConfig() {
  if (typeof window === "undefined") return makeConfig();
  return (browserConfig ??= makeConfig());
}
export function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  return (browserQueryClient ??= new QueryClient());
}
