"use client";

import { getChainConfig } from "@misthos/shared/chains";
import { QueryClient } from "@tanstack/react-query";
import { createConfig, http, type CreateConnectorFn } from "wagmi";

export const chain = getChainConfig().chain;

/**
 * RainbowKit's connectors, when they were loaded before the config was made (a returning visitor, so the saved
 * connection can be restored whatever wallet it used). New visitors start with only the browser's own wallets
 * (EIP-6963, no SDKs) and get the rest on their first "Connect wallet" (`ensureRainbowConnectors`).
 */
let preloaded: CreateConnectorFn[] | undefined;
export function preloadConnectors(fns: CreateConnectorFn[]) {
  if (!browserConfig) preloaded = fns;
}

function makeConfig() {
  const browser = typeof window !== "undefined";
  return createConfig({
    chains: [chain],
    transports: { [chain.id]: http() },
    // Restore the saved connection once, in an effect (see Web3Provider), not during render.
    ssr: true,
    connectors: browser ? (preloaded ?? []) : [],
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

const rdnsOf = (c: { rdns?: string | readonly string[] }) =>
  c.rdns === undefined ? [] : typeof c.rdns === "string" ? [c.rdns] : [...c.rdns];

let adding: Promise<void> | undefined;
/**
 * Add RainbowKit's connectors to the live config (once). Called only while no wallet is connected: an extension
 * found earlier through EIP-6963 is replaced by RainbowKit's connector for the same wallet, as createConfig would
 * have done had they been there from the start.
 */
export function ensureRainbowConnectors(): Promise<void> {
  const config = getWalletConfig();
  if (preloaded) return Promise.resolve();
  adding ??= import("./rainbow-connectors").then(({ rainbowConnectors }) => {
    const created = rainbowConnectors().map((fn) => config._internal.connectors.setup(fn));
    const rdns = new Set(created.flatMap(rdnsOf));
    config._internal.connectors.setState((prev) => [
      ...prev.filter((c) => !(c.type === "injected" && rdns.has(c.id))),
      ...created,
    ]);
  });
  return adding;
}
