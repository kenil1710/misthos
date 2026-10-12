import "server-only";
import { NETWORK_COOKIE, parseNetwork, type ChainKey } from "@misthos/shared";
import { cookies } from "next/headers";

/** The network the visitor picked in the header (Arc Testnet unless they chose Arc Mainnet). */
export async function selectedNetwork(): Promise<ChainKey> {
  return parseNetwork((await cookies()).get(NETWORK_COOKIE)?.value);
}
