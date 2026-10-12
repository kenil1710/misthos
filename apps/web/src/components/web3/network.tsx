"use client";

import { getChainConfig, type ChainKey } from "@misthos/shared/chains";
import { createContext, useContext, type ReactNode } from "react";

const NetworkContext = createContext<ChainKey | null>(null);

/**
 * The network wallet actions on a page target: a program's pages wrap their content in its network, so its vault
 * transactions, "wrong network" checks and explorer links use Arc Testnet or Arc Mainnet as the program does.
 */
export function ProgramNetwork({ chain, children }: { chain: string; children: ReactNode }) {
  const key = getChainConfig(chain).key;
  return <NetworkContext.Provider value={key}>{children}</NetworkContext.Provider>;
}

/** The program's network on a program's pages, else null. */
export function useProgramNetwork(): ChainKey | null {
  return useContext(NetworkContext);
}

/** The target network's config: the program's (inside ProgramNetwork), else the app's primary network. */
export function useTargetNetwork() {
  return getChainConfig(useContext(NetworkContext) ?? undefined);
}
