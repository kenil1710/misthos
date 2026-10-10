import { describe, expect, it } from "vitest";
import { minimumRuleText, minimumStatus } from "@/lib/minimums";

const now = new Date("2026-10-10T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("minimum followers and account age", () => {
  const rules = { minXFollowers: 100, minAccountAgeDays: 30 };
  it("says what the contributor has, what's asked, and what will happen, per policy", () => {
    const small = { followers: 40, createdAt: daysAgo(5) };
    expect(minimumStatus({ ...rules, belowMinimum: "review" }, small, now)).toMatchObject({
      below: true,
      outcome: "review",
      followers: { have: 40, need: 100, ok: false },
      age: { days: 5, need: 30, ok: false },
      text: "You have 40 followers (this program asks for 100) and an account 5 days old (this program asks for 30). You can join and post; the team reviews your work before it's paid.",
    });
    expect(minimumStatus({ ...rules, belowMinimum: "reject" }, small, now).text).toMatch(
      /rejected automatically\.$/,
    );
    expect(minimumStatus({ ...rules, belowMinimum: "block" }, small, now)).toMatchObject({
      outcome: "block",
      text: expect.stringMatching(/You can't join with this account\.$/),
    });
    // Joined before "Can't join" was chosen: told what happens to their posts instead.
    expect(minimumStatus({ ...rules, belowMinimum: "block" }, small, now, true).text).toMatch(
      /Posts from this account are rejected automatically\.$/,
    );
  });
  it("meeting both minimums, or none set, is fine; unknown counts are never held against anyone", () => {
    const big = { followers: 1200, createdAt: daysAgo(900) };
    expect(minimumStatus({ ...rules, belowMinimum: "block" }, big, now)).toMatchObject({
      below: false,
      outcome: "ok",
      text: "Your X account meets this program's minimums.",
    });
    expect(
      minimumStatus({ minXFollowers: 0, minAccountAgeDays: 0, belowMinimum: "block" }, big, now),
    ).toMatchObject({ applies: false, outcome: "ok" });
    expect(
      minimumStatus({ ...rules, belowMinimum: "block" }, { followers: null, createdAt: null }, now),
    ).toMatchObject({ below: false, outcome: "ok" });
  });
  it("the join page rule reads per policy", () => {
    expect(minimumRuleText({ ...rules, belowMinimum: "review" })).toBe(
      "X accounts with fewer than 100 followers or younger than 30 days are reviewed by the team before payment.",
    );
    expect(
      minimumRuleText({ minXFollowers: 100, minAccountAgeDays: 0, belowMinimum: "reject" }),
    ).toBe("X posts from accounts with fewer than 100 followers are rejected automatically.");
    expect(
      minimumRuleText({ minXFollowers: 0, minAccountAgeDays: 30, belowMinimum: "block" }),
    ).toBe("X accounts younger than 30 days can't join.");
    expect(
      minimumRuleText({ minXFollowers: 0, minAccountAgeDays: 0, belowMinimum: "block" }),
    ).toBeNull();
  });
});

describe("the overview's submission rules card", () => {
  it("lists every rule in plain words, with the policy only when a minimum is set", async () => {
    const { submissionRuleRows } = await import("@/lib/minimums");
    expect(
      submissionRuleRows({
        minXFollowers: 100,
        minAccountAgeDays: 30,
        belowMinimum: "reject",
        maxSubmissionsPerRound: 5,
        mustInclude: ["@cronpay_", "#CronPay"],
        acceptsArticles: true,
      }),
    ).toEqual([
      ["Minimum X followers", "100"],
      ["Minimum account age", "30 days"],
      ["Below the minimums", "Reject automatically"],
      ["Submissions per round", "Up to 5 per contributor"],
      ["Required mention", "@cronpay_, #CronPay"],
      ["Articles", "Always reviewed by you"],
    ]);
    expect(
      submissionRuleRows({
        minXFollowers: 0,
        minAccountAgeDays: 0,
        belowMinimum: "review",
        maxSubmissionsPerRound: 1,
        mustInclude: [],
        acceptsArticles: false,
      }).map((r) => r[0]),
    ).toEqual([
      "Minimum X followers",
      "Minimum account age",
      "Submissions per round",
      "Required mention",
    ]);
  });
});
