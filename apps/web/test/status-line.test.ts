import { describe, expect, it } from "vitest";
import { programStatusLine, roundPhrase } from "@/lib/status-line";

const now = Date.UTC(2026, 9, 3, 12);
const day = 86_400_000;
const round = (o: Partial<{ startsAt: Date; endsAt: Date; status: string }> = {}) => ({
  number: 1,
  startsAt: new Date(now - day),
  endsAt: new Date(now + 6 * day),
  status: "open",
  ...o,
});

describe("programStatusLine", () => {
  it("open round with activity", () => {
    expect(
      programStatusLine(
        { status: "active", round: round(), submissions: 0, readyToPay: 4_000_000n },
        now,
      ).join(" · "),
    ).toBe("Round 1 is open · ends in 6 days · 0 submissions · 4.00 USDC ready to pay");
  });
  it("scheduled round", () => {
    expect(
      roundPhrase(
        round({ startsAt: new Date(now + 2 * day), endsAt: new Date(now + 9 * day) }),
        now,
      ),
    ).toEqual(["Round 1 starts in 2 days"]);
  });
  it("draft and paused", () => {
    expect(
      programStatusLine({ status: "draft", round: null, submissions: 0, readyToPay: 0n }, now)[0],
    ).toBe("Draft");
    expect(
      programStatusLine(
        { status: "paused", round: round(), submissions: 1, readyToPay: 0n },
        now,
      ).join(" · "),
    ).toBe(
      "Joining paused · Round 1 is open · ends in 6 days · 1 submission · 0.00 USDC ready to pay",
    );
  });
  it("rounds being paid or paid", () => {
    expect(roundPhrase(round({ status: "proposed" }), now)).toEqual(["Round 1 is being paid"]);
    expect(roundPhrase(round({ status: "executed" }), now)).toEqual(["Round 1 paid"]);
  });
});
