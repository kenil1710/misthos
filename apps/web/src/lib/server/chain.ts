import "server-only";
import { getChainConfig } from "@misthos/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { env } from "./env";

let client: PublicClient | undefined;

export function chainConfig() {
  return getChainConfig(env().NEXT_PUBLIC_CHAIN);
}

/** Server-side public client for the configured Arc network (signature verification, reads). */
export function publicClient(): PublicClient {
  if (!client) {
    const cfg = chainConfig();
    client = createPublicClient({
      chain: cfg.chain,
      transport: http(env().ARC_RPC_URL || undefined),
    }) as PublicClient;
  }
  return client;
}
