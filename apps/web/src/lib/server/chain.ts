import "server-only";
import { getChainConfig, isChainKey, networkConfig, type ChainKey } from "@misthos/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { env } from "./env";

const clients = new Map<ChainKey, PublicClient>();

/**
 * Page reads and verifications are single calls (a multicall, a receipt, a signature check). viem's default (10 s
 * timeout, 3 retries) could hold a page for ~40 s on one bad RPC moment; this caps it at about 8 s.
 */
export const RPC_TIMEOUT_MS = 4_000;
export const RPC_RETRY_COUNT = 1;

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
    client = createPublicClient({
      chain: cfg.chain,
      // ARC_RPC_URL (testnet) or ARC_MAINNET_RPC_URL, else the network's public RPC.
      transport: http(networkConfig(cfg.key).rpcUrl, {
        timeout: RPC_TIMEOUT_MS,
        retryCount: RPC_RETRY_COUNT,
      }),
    }) as PublicClient;
    clients.set(cfg.key, client);
  }
  return client;
}
