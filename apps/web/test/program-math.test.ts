import { describe, expect, it } from "vitest";
import {
  deriveDefaultLimits,
  itemNoun,
  limitWarnings,
  payoutFor,
  perfectLine,
  perfectPayout,
} from "@/lib/program-math";
import { fromNow, localAndUtc } from "@/lib/when";

const U = 1_000_000n;

describe("points → USDC", () => {
  it("a perfect submission earns max points × rate; an average 7/10 earns 70% of that", () => {
    expect(perfectPayout(10, U / 2n)).toBe(5n * U);
    expect(perfectPayout(20, U / 2n)).toBe(10n * U);
    expect(payoutFor(10, 7, U / 2n)).toBe(3_500_000n);
  });
});

describe("safe defaults", () => {
  it("derives limits from the best perfect submission instead of fixed large numbers", () => {
    expect(deriveDefaultLimits(10n * U)).toEqual({
      maxAutoApproveItem: "10.00",
      maxPerPayout: "30.00",
      maxPerRound: "150.00",
      maxPerDay: "300.00",
      autoApproveThreshold: "50.00",
    });
  });
});

describe("limit warnings", () => {
  const base = {
    maxCategoryPayout: 10n * U,
    maxAutoApproveItem: 10n * U,
    maxPerPayout: 30n * U,
    maxPerRound: 150n * U,
    maxPerDay: 300n * U,
    autoApproveThreshold: 50n * U,
  };
  it("is quiet for the derived defaults", () => {
    expect(limitWarnings(base)).toEqual([]);
  });
  it("warns when the review-free item cap is above the per-contributor cap", () => {
    expect(limitWarnings({ ...base, maxAutoApproveItem: 40n * U }).map((w) => w.field)).toContain(
      "maxAutoApproveItem",
    );
  });
  it("warns when a perfect submission can't be paid in full", () => {
    expect(limitWarnings({ ...base, maxPerPayout: 5n * U }).map((w) => w.field)).toContain(
      "maxPerPayout",
    );
  });
  it("warns when the approval threshold can never be reached", () => {
    expect(
      limitWarnings({ ...base, autoApproveThreshold: 150n * U }).map((w) => w.field),
    ).toContain("autoApproveThreshold");
  });
});

describe("unambiguous times", () => {
  it("shows the UTC time alongside the local one", () => {
    expect(localAndUtc(new Date("2026-10-02T14:30:00Z"))).toMatch(/2 Oct 2026.* · 14:30 UTC$/);
  });
  it("says how far away a time is", () => {
    const now = Date.parse("2026-10-02T14:30:00Z");
    expect(fromNow(new Date(now + 6 * 86_400_000), now)).toBe("in 6 days");
    expect(fromNow(new Date(now + 3 * 3_600_000), now)).toBe("in 3 hours");
    expect(fromNow(new Date(now), now)).toBe("now");
  });
});

describe("itemNoun / perfectLine (grammar of generated copy)", () => {
  it("turns plural category names into the singular", () => {
    expect(itemNoun("Threads and posts")).toBe("thread or post");
    expect(itemNoun("Pull requests")).toBe("pull request");
    expect(itemNoun("Articles")).toBe("article");
    expect(itemNoun("Guides, tutorials & demos")).toBe("guide or tutorial or demo");
    expect(itemNoun("Bounties")).toBe("bounty");
    expect(itemNoun("GitHub commits")).toBe("GitHub commit");
  });
  it("quotes names that aren't plural lists", () => {
    expect(itemNoun("Code")).toBe("“Code” submission");
    expect(itemNoun("")).toBe("submission");
  });
  it("writes the full sentence", () => {
    expect(perfectLine("Threads and posts", "0.50 USDC")).toBe(
      "A perfect thread or post (10/10) earns 0.50 USDC",
    );
  });
});
