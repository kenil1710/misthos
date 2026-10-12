import { describe, expect, it } from "vitest";
import { asText } from "@/lib/metrics-text";
import { deriveDefaultLimits, deriveMainnetLimits, MAINNET_SAFE_LIMITS } from "@/lib/program-math";
import type { Metrics } from "@/lib/server/metrics";
import { LimitsInput } from "@misthos/shared";

const metrics = (o: Partial<Metrics>): Metrics => ({
  programsOnboarded: 0,
  programsActive: 0,
  contributors: 0,
  activeContributors30d: 0,
  submissionsReviewed: 0,
  autoApprovedPct: null,
  escalatedPct: null,
  fraudByFlag: {},
  usdcPaidTestnet: 0n,
  usdcPaidMainnet: 0n,
  contributorsPaid: 0,
  roundsExecuted: 0,
  medianReviewSeconds: null,
  xSpendUsd: 0,
  xCalls: 0,
  llmSpendUsd: 0,
  ...o,
});

describe("Copy for submission form", () => {
  it("reports Arc Mainnet and Arc Testnet apart, each with its own USDC, never a sum", () => {
    const text = asText({
      "arc-testnet": metrics({
        programsOnboarded: 3,
        usdcPaidTestnet: 2_500_000n,
        contributorsPaid: 4,
      }),
      "arc-mainnet": metrics({
        programsOnboarded: 1,
        usdcPaidMainnet: 1_000_000n,
        contributorsPaid: 1,
      }),
    });
    const [mainnet, testnet] = text.split("\n\n");
    expect(mainnet).toMatch(/^Arc Mainnet \(real USDC\):/);
    expect(mainnet).toContain("Programs onboarded: 1");
    expect(mainnet).toContain("USDC paid: 1.00 USDC to 1 contributors");
    expect(testnet).toMatch(/^Arc Testnet \(test USDC\):/);
    expect(testnet).toContain("Programs onboarded: 3");
    expect(testnet).toContain("USDC paid: 2.50 USDC to 4 contributors");
    expect(text).not.toContain("3.50");
    expect(text).toContain("Demo programs excluded.");
  });
});

describe("safe starting limits on Arc Mainnet", () => {
  it("low caps and the owner's approval for every round; valid for the vault", () => {
    for (const item of [100_000n, 1_000_000n, 5_000_000n, 50_000_000n, 0n]) {
      const m = deriveMainnetLimits(item);
      const d = deriveDefaultLimits(item);
      expect(m.autoApproveThreshold).toBe("0.00");
      const p = LimitsInput.parse({ ...m, payeeCooldownHours: "24" });
      expect(p.maxPerPayout).toBeLessThanOrEqual(MAINNET_SAFE_LIMITS.maxPerPayout);
      expect(p.maxPerRound).toBeLessThanOrEqual(MAINNET_SAFE_LIMITS.maxPerRound);
      expect(p.maxPerDay).toBeLessThanOrEqual(MAINNET_SAFE_LIMITS.maxPerDay);
      expect(p.autoApproveThreshold).toBe(0n);
      // Never above what testnet would suggest for the same rubric.
      expect(p.maxPerPayout).toBeLessThanOrEqual(
        LimitsInput.parse({ ...d, payeeCooldownHours: "24" }).maxPerPayout,
      );
    }
  });

  it("testnet suggestions are unchanged", () => {
    expect(deriveDefaultLimits(5_000_000n)).toEqual({
      maxAutoApproveItem: "5.00",
      maxPerPayout: "15.00",
      maxPerRound: "75.00",
      maxPerDay: "150.00",
      autoApproveThreshold: "25.00",
    });
  });
});
