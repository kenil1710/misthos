"use client";

import { getChainConfig } from "@misthos/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { discoverAllowedWallets } from "@/lib/wallets";

const chainConfig = getChainConfig();

function makeConfig() {
  const defaults = getDefaultConfig({
    appName: "Misthos",
    appDescription: "Contributor payroll, run by an agent you can audit.",
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    chains: [chainConfig.chain],
    transports: { [chainConfig.chain.id]: http() },
    // WalletConnect's client needs browser storage (indexedDB); only add it in the browser so server
    // rendering doesn't start it. The connect button renders the same either way.
    walletConnectProjectId:
      typeof window === "undefined" ? "" : (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ""),
    enableAaveAccount: false,
    ssr: true,
  });
  // Only allowlisted browser wallets (MetaMask, Rabby, Coinbase), each as its own connector, plus ConnectKit's
  // Coinbase SDK and WalletConnect. Discovery of every other installed extension is turned off.
  const discovered = discoverAllowedWallets().map((w) =>
    injected({
      target: () => ({
        id: w.info.rdns,
        name: w.info.name,
        icon: w.info.icon,
        provider: w.provider as never,
      }),
    }),
  );
  return createConfig({
    ...defaults,
    connectors: [...discovered, ...(defaults.connectors ?? [])],
    multiInjectedProviderDiscovery: false,
  });
}

let browserConfig: ReturnType<typeof makeConfig> | undefined;

/** One config per browser tab: each config starts its own WalletConnect client, which must only happen once. */
function getConfig() {
  if (typeof window === "undefined") return makeConfig();
  return (browserConfig ??= makeConfig());
}

/** wagmi + ConnectKit, themed to follow the app's light/dark mode. */
export function Web3Provider({ children }: { children: ReactNode }) {
  const [config] = useState(getConfig);
  const [queryClient] = useState(() => new QueryClient());
  const { resolvedTheme } = useTheme();
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode={resolvedTheme === "dark" ? "dark" : "light"}
          customTheme={{
            "--ck-font-family": "var(--font-geist-sans)",
            "--ck-border-radius": "10px",
          }}
          options={{ hideBalance: true, enforceSupportedChains: true }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
