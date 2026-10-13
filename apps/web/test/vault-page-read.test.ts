import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
const multicall = vi.fn();
vi.mock("@/lib/server/chain", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/chain")>()),
  chainConfig: () => ({ key: "arc-testnet", explorerUrl: "", tokens: { usdc: "0x" } }),
  publicClient: () => ({ multicall }),
}));
const { readVaultForPage } = await import("@/lib/server/vault");

const VAULT = "0x3cfdbaa3cf656d4e254a6a11666c13461dd35334" as const;
const limits = {
  maxPerPayout: 1n,
  maxPerRound: 2n,
  maxPerDay: 3n,
  autoApproveThreshold: 4n,
  payeeCooldown: 86400,
};

describe("readVaultForPage (Treasury and Settings)", () => {
  beforeEach(() => {
    multicall.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the vault state when Arc answers", async () => {
    multicall.mockResolvedValue([10n, 20n, 5n, 0n, 1n, false, "0xa", "0xb", limits]);
    const s = await readVaultForPage(VAULT, "arc-testnet");
    expect(s?.balance).toBe(10n);
    expect(s?.limits.payeeCooldown).toBe(86400n);
  });

  it("returns null instead of throwing when the RPC times out, so the page renders a notice", async () => {
    multicall.mockRejectedValue(
      Object.assign(new Error("The request took too long"), { name: "TimeoutError" }),
    );
    await expect(readVaultForPage(VAULT, "arc-testnet")).resolves.toBeNull();
  });

  it("tries again on the next request after a failure", async () => {
    multicall.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await readVaultForPage(VAULT, "arc-testnet")).toBeNull();
    multicall.mockResolvedValueOnce([7n, 7n, 0n, 0n, 0n, true, "0xa", "0xb", limits]);
    expect((await readVaultForPage(VAULT, "arc-testnet"))?.paused).toBe(true);
  });
});
