import { describe, expect, it } from "vitest";
import { idempotencyUuid } from "../src/chain/executor";
import { networkSeed, onProgramNetwork } from "../src/network";

describe("network guards", () => {
  it("deps match a program only on its own Arc network; unknown names never match", () => {
    expect(onProgramNetwork(5042002, "arc-testnet")).toBe(true);
    expect(onProgramNetwork(5042, "arc-mainnet")).toBe(true);
    expect(onProgramNetwork(5042002, "arc-mainnet")).toBe(false);
    expect(onProgramNetwork(5042, "arc-testnet")).toBe(false);
    expect(onProgramNetwork(5042, "ethereum")).toBe(false);
    expect(onProgramNetwork(1, "")).toBe(false);
  });

  it("idempotency seeds: Arc Testnet's are unchanged, Arc Mainnet's can't collide with them", () => {
    const seed = `execute:0x${"ab".repeat(20)}:0x${"01".repeat(32)}`;
    expect(networkSeed(5042002, seed)).toBe(seed);
    expect(idempotencyUuid(networkSeed(5042002, seed))).toBe(idempotencyUuid(seed));
    expect(networkSeed(5042, seed)).toBe(`arc-mainnet:${seed}`);
    expect(idempotencyUuid(networkSeed(5042, seed))).not.toBe(idempotencyUuid(seed));
  });
});
