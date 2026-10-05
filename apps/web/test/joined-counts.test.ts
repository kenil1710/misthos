import { describe, expect, it } from "vitest";
import { joinedCounts } from "../src/lib/joined-counts";

describe("joinedCounts", () => {
  it("counts a paid submission as paid, not as zero approved", () => {
    // The real case: one thread paid in round 1, one post rejected in round 2.
    expect(
      joinedCounts([
        { status: "paid", n: 1, amount: "366666" },
        { status: "rejected", n: 1, amount: "0" },
      ]),
    ).toEqual({ submitted: 2, inReview: 0, approved: 0, approvedAmount: 0n, paid: 1 });
  });

  it("groups queued, processing and escalated as in review, and approved + partial as approved, not paid", () => {
    expect(
      joinedCounts([
        { status: "pending", n: 1, amount: "0" },
        { status: "processing", n: 1, amount: "0" },
        { status: "escalated", n: 2, amount: "500000" },
        { status: "approved", n: 2, amount: "1500000" },
        { status: "partial", n: 1, amount: "250000" },
        { status: "paid", n: 3, amount: "3000000" },
      ]),
    ).toEqual({ submitted: 10, inReview: 4, approved: 3, approvedAmount: 1_750_000n, paid: 3 });
  });

  it("is all zeros with no submissions", () => {
    expect(joinedCounts([])).toEqual({
      submitted: 0,
      inReview: 0,
      approved: 0,
      approvedAmount: 0n,
      paid: 0,
    });
  });
});
