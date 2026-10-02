import { describe, expect, it } from "vitest";
import { GithubLogin } from "../src/identity";
import {
  LimitsInput,
  ProgramBasics,
  Rubric,
  Slug,
  toStoredLimits,
  BudgetInput,
} from "../src/program";

const category = {
  key: "threads",
  name: "Threads",
  description: "Original educational threads about Arc",
  sourceTypes: ["x_post"],
  maxPoints: 10,
  criteria: [{ key: "depth", name: "Depth", description: "Explains how things work" }],
};

describe("Slug", () => {
  it("normalizes and validates", () => {
    expect(Slug.parse(" Arc-Builders ")).toBe("arc-builders");
    for (const bad of ["ab", "-abc", "abc-", "a--b", "has space", "app", "p"]) {
      expect(Slug.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("ProgramBasics", () => {
  it("only accepts https logo URLs or empty", () => {
    const base = {
      name: "Arc Builders",
      slug: "arc-builders",
      description: "Pays for Arc content.",
    };
    expect(ProgramBasics.safeParse({ ...base, logoUrl: "" }).success).toBe(true);
    expect(ProgramBasics.safeParse({ ...base, logoUrl: "https://x.test/logo.png" }).success).toBe(
      true,
    );
    expect(ProgramBasics.safeParse({ ...base, logoUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(ProgramBasics.safeParse({ ...base, logoUrl: "http://x.test/logo.png" }).success).toBe(
      false,
    );
  });
});

describe("Rubric", () => {
  it("accepts a valid rubric and applies defaults", () => {
    const r = Rubric.parse({ categories: [category] });
    expect(r.categories[0]!.requireMerged).toBe(true);
    expect(r.generalRules).toBe("");
  });

  it("rejects duplicate category and criterion keys", () => {
    expect(Rubric.safeParse({ categories: [category, category] }).success).toBe(false);
    const dupCrit = { ...category, criteria: [category.criteria[0], category.criteria[0]] };
    expect(Rubric.safeParse({ categories: [dupCrit] }).success).toBe(false);
  });
});

describe("LimitsInput", () => {
  const ok = {
    maxPerPayout: "50",
    maxPerRound: "500",
    maxPerDay: "1000",
    autoApproveThreshold: "200",
    payeeCooldownHours: "24",
  };

  it("parses decimal USDC into base units", () => {
    const l = LimitsInput.parse({ ...ok, maxPerPayout: "12.5" });
    expect(l.maxPerPayout).toBe(12_500_000n);
    expect(l.payeeCooldownHours).toBe(24);
  });

  it("mirrors the vault's ordering rules", () => {
    expect(LimitsInput.safeParse({ ...ok, maxPerPayout: "0" }).success).toBe(false);
    expect(LimitsInput.safeParse({ ...ok, maxPerRound: "10" }).success).toBe(false);
    expect(LimitsInput.safeParse({ ...ok, maxPerDay: "100" }).success).toBe(false);
    expect(LimitsInput.safeParse({ ...ok, maxPerPayout: "1.1234567" }).success).toBe(false);
  });

  it("converts to stored base-unit strings", () => {
    const budget = BudgetInput.parse({
      ratePerPoint: "2",
      roundLengthDays: "14",
      firstRoundStartsAt: "2026-10-05",
      autoApproveConfidence: "0.8",
      maxAutoApproveItem: "25",
      minAccountAgeDays: "30",
    });
    expect(toStoredLimits(LimitsInput.parse(ok), budget)).toEqual({
      maxPerPayout: "50000000",
      maxPerRound: "500000000",
      maxPerDay: "1000000000",
      autoApproveThreshold: "200000000",
      payeeCooldownSeconds: 86400,
      maxAutoApproveItem: "25000000",
    });
  });
});

describe("GithubLogin", () => {
  it("strips @ and validates GitHub rules", () => {
    expect(GithubLogin.parse("@octo-cat")).toBe("octo-cat");
    for (const bad of ["-octo", "octo-", "oc--to", "a".repeat(40), "has space"]) {
      expect(GithubLogin.safeParse(bad).success, bad).toBe(false);
    }
  });
});
