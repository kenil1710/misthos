import { describe, expect, it } from "vitest";
import { ARC_CHAINS, getChainConfig, NATIVE_TO_ERC20_SCALE } from "../src/chains";

describe("chains", () => {
  it("has verified chain ids", () => {
    expect(ARC_CHAINS["arc-testnet"].chain.id).toBe(5042002);
    expect(ARC_CHAINS["arc-mainnet"].chain.id).toBe(5042);
  });
  it("uses the ERC-20 USDC interface on both networks", () => {
    for (const c of Object.values(ARC_CHAINS)) {
      expect(c.tokens.usdc).toBe("0x3600000000000000000000000000000000000000");
      expect(c.chain.nativeCurrency.decimals).toBe(18);
    }
    expect(NATIVE_TO_ERC20_SCALE).toBe(10n ** 12n);
  });
  it("defaults to testnet and rejects unknown keys", () => {
    expect(getChainConfig(undefined).key).toBe("arc-testnet");
    expect(() => getChainConfig("ethereum")).toThrow();
  });
});
