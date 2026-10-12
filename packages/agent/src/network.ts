import { arcMainnet, getChainConfig, isChainKey } from "@misthos/shared";

/**
 * Whether a job's dependencies (signer, executor, vault reader, all bound to `chainId`) are on the program's network.
 * Every entry point checks this before claiming or locking anything, so a mix-up (a mainnet program handed testnet
 * dependencies, or the reverse) changes nothing and signs nothing. An unknown network name never matches.
 */
export function onProgramNetwork(chainId: number, programChain: string): boolean {
  return isChainKey(programChain) && getChainConfig(programChain).chain.id === chainId;
}

/**
 * An idempotency seed for one network. Arc Mainnet's seeds are prefixed, so a key can never match one from another
 * network even if two vaults shared an address; Arc Testnet's are unchanged (a retried in-flight call keeps its key).
 */
export function networkSeed(chainId: number, seed: string): string {
  return chainId === arcMainnet.id ? `arc-mainnet:${seed}` : seed;
}
