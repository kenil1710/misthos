/**
 * Stand-in for `@base-org/account`. RainbowKit bundles wagmi's Base Account connector, whose SDK drags in the
 * Coinbase CDP server SDK and its optional x402 packages. Misthos doesn't offer Base Account, so the import
 * resolves here (next.config.ts) and the SDK never ships.
 */
export function createBaseAccountSDK(): never {
  throw new Error("Base Account isn't offered on Misthos.");
}
