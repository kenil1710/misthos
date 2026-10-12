import { describe, expect, it } from "vitest";
import { networkConfig, parseNetwork, allNetworks } from "../src/network";

describe("networkConfig: everything about a program's network", () => {
  it("Arc Testnet: chain id, RPC, explorer, USDC, factory, Circle blockchain, agent", () => {
    const n = networkConfig("arc-testnet", { CIRCLE_AGENT_WALLET_ADDRESS: `0x${"a".repeat(40)}` });
    expect(n).toMatchObject({
      chainId: 5042002,
      rpcUrl: "https://rpc.testnet.arc.io",
      explorerUrl: "https://explorer.testnet.arc.io",
      usdc: "0x3600000000000000000000000000000000000000",
      vaultFactory: "0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b",
      circleBlockchain: "ARC-TESTNET",
      agentWallet: `0x${"a".repeat(40)}`,
      isTestnet: true,
      faucetUrl: "https://faucet.circle.com",
    });
  });

  it("Arc Mainnet: its own factory and agent; never the testnet agent; no faucet", () => {
    const testnetOnly = {
      CIRCLE_AGENT_WALLET_ADDRESS: `0x${"a".repeat(40)}`,
      AGENT_ADDRESS: `0x${"c".repeat(40)}`,
    };
    expect(networkConfig("arc-mainnet", testnetOnly)).toMatchObject({
      chainId: 5042,
      name: "Arc Mainnet",
      rpcUrl: "https://rpc.mainnet.arc.io",
      explorerUrl: "https://explorer.arc.io",
      usdc: "0x3600000000000000000000000000000000000000",
      vaultFactory: "0x9075CbB50639216C2e4E32013514baa01f2b0C1b",
      vaultImplementation: "0x36E677De57Ce0f59eFed05a748B07c7Bb07d5dBb",
      circleBlockchain: "ARC",
      agentWallet: null,
      isTestnet: false,
      faucetUrl: null,
    });
    expect(
      networkConfig("arc-mainnet", {
        CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: `0x${"b".repeat(40)}`,
        ARC_MAINNET_RPC_URL: "https://rpc.example/arc",
      }),
    ).toMatchObject({ agentWallet: `0x${"b".repeat(40)}`, rpcUrl: "https://rpc.example/arc" });
  });

  it("an unknown network throws instead of falling back to another", () => {
    expect(() => networkConfig("ethereum", {})).toThrow('Unknown network "ethereum"');
    expect(() => networkConfig("", {})).toThrow();
  });

  it("a malformed agent address counts as not configured", () => {
    expect(
      networkConfig("arc-mainnet", { CIRCLE_MAINNET_AGENT_WALLET_ADDRESS: "0x123" }).agentWallet,
    ).toBeNull();
  });

  it("the visitor's choice: only the two Arc keys, default testnet", () => {
    expect(parseNetwork("arc-mainnet")).toBe("arc-mainnet");
    expect(parseNetwork("arc-testnet")).toBe("arc-testnet");
    for (const v of [undefined, "", "mainnet", "ARC-MAINNET", 5042, null])
      expect(parseNetwork(v)).toBe("arc-testnet");
    expect(allNetworks({}).map((n) => n.key)).toEqual(["arc-testnet", "arc-mainnet"]);
  });
});
