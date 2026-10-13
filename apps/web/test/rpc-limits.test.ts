import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/env", () => ({ env: () => ({ NEXT_PUBLIC_CHAIN: "arc-testnet" }) }));
const { publicClient, RPC_RETRY_COUNT, RPC_TIMEOUT_MS } = await import("@/lib/server/chain");

describe("web RPC client limits", () => {
  it("caps a slow Arc call at about 8 s instead of viem's ~40 s default", () => {
    expect(RPC_TIMEOUT_MS).toBe(4_000);
    expect(RPC_RETRY_COUNT).toBe(1);
    expect((RPC_RETRY_COUNT + 1) * RPC_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
  });

  it("applies them to both networks' clients", () => {
    for (const key of ["arc-testnet", "arc-mainnet"]) {
      const t = publicClient(key).transport as { timeout?: number; retryCount?: number };
      expect(t.timeout).toBe(RPC_TIMEOUT_MS);
      expect(t.retryCount).toBe(RPC_RETRY_COUNT);
    }
  });
});
