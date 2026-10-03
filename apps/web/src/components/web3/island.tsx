"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

/**
 * A wallet-dependent component, loaded after the page is interactive and wrapped in its own provider (all providers
 * share one wagmi config, so they share one connection). Keeps wagmi, viem and the connectors out of the page's
 * first load. `placeholder` holds the component's space while it loads, so nothing shifts.
 */
export function walletIsland<P extends object>(
  load: () => Promise<ComponentType<P>>,
  placeholder: ReactNode = null,
): ComponentType<P> {
  return dynamic(
    async () => {
      const [{ Web3Provider }, C] = await Promise.all([import("./web3-provider"), load()]);
      function Island(props: P) {
        return (
          <Web3Provider>
            <C {...props} />
          </Web3Provider>
        );
      }
      return Island;
    },
    { ssr: false, loading: () => <>{placeholder}</> },
  );
}
