import "server-only";
import { getChainConfig, isChainKey, type ChainKey } from "@misthos/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { env } from "./env";

const clients = new Map<ChainKey, PublicClient>();

/** The app's primary network (NEXT_PUBLIC_CHAIN): where new programs land by default. */
export function primaryChain(): ChainKey {
  return env().NEXT_PUBLIC_CHAIN;
}

/**
 * A network's config. Pass the program's `chain` wherever a program is involved; with no argument it's the primary
 * network. An unknown key throws rather than silently using another network.
 */
export function chainConfig(key?: string) {
  if (key !== undefined && !isChainKey(key)) throw new Error(`Unknown network "${key}"`);
  return getChainConfig(key ?? primaryChain());
}

/** Server-side public client for one Arc network (signature verification, reads). */
export function publicClient(key?: string): PublicClient {
  const cfg = chainConfig(key);
  let client = clients.get(cfg.key);
  if (!client) {
    const rpc = cfg.key === "arc-mainnet" ? env().ARC_MAINNET_RPC_URL : env().ARC_RPC_URL;
    client = createPublicClient({
      chain: cfg.chain,
      transport: http(rpc || undefined),
    }) as PublicClient;
    clients.set(cfg.key, client);
  }
  return client;
}
