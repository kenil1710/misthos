"use client";

import { getChainConfig } from "@misthos/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";

const chainConfig = getChainConfig();

export const wagmiConfig = createConfig(
  getDefaultConfig({
    appName: "Misthos",
    appDescription: "Contributor payroll, run by an agent you can audit.",
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    chains: [chainConfig.chain],
    transports: { [chainConfig.chain.id]: http() },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
    enableAaveAccount: false,
    ssr: true,
  }),
);

/** wagmi + ConnectKit, themed to follow the app's light/dark mode. */
export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const { resolvedTheme } = useTheme();
  return (
    <WagmiProvider config={wagmiConfig}>
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
