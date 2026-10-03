"use client";

import { useAccount } from "wagmi";
import { useHydrated } from "@/lib/use-hydrated";

const SERVER_SNAPSHOT = {
  address: undefined,
  chainId: undefined,
  connector: undefined,
  isConnected: false,
  status: "disconnected",
} as const;

/**
 * `useAccount`, but identical on the server and the first client render (disconnected), then live. wagmi starts
 * reconnecting before hydration finishes, which otherwise makes server and client HTML disagree.
 */
export function useWalletAccount() {
  const account = useAccount();
  const hydrated = useHydrated();
  return hydrated ? { ...account, hydrated } : { ...account, ...SERVER_SNAPSHOT, hydrated };
}
