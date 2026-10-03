import { describe, expect, it } from "vitest";
import {
  boardStage,
  reasoningChecks,
  scoreLines,
  submissionJourney,
  type JourneyInput,
} from "@/lib/journey";

const base: JourneyInput = {
  status: "approved",
  createdAt: "2026-10-03T10:00:00Z",
  decision: {
    action: "approve",
    amount: "370000",
    createdAt: "2026-10-03T10:01:00Z",
    flags: [],
    scored: true,
    decidedBy: "agent",
  },
  round: { number: 1, status: "open", endsAt: "2026-10-09T10:00:00Z" },
  payout: null,
};
const states = (j: JourneyInput) => submissionJourney(j).map((s) => `${s.key}:${s.state}`);

describe("submissionJourney", () => {
  it("approved, waiting for the round to close", () => {
    expect(states(base)).toEqual([
      "submitted:done",
      "fetched:done",
      "checks:done",
      "scored:done",
      "decision:done",
      "round:done",
      "paid:waiting",
    ]);
    expect(submissionJourney(base)[4]!.label).toBe("Approved · 0.37 USDC");
  });
  it("paid, with the transaction", () => {
    const s = submissionJourney({
      ...base,
      status: "paid",
      payout: { status: "executed", txHash: "0xabc" },
    });
    expect(s.at(-1)).toMatchObject({ key: "paid", state: "done", txHash: "0xabc" });
  });
  it("still processing", () => {
    expect(states({ ...base, status: "processing", decision: null })).toEqual([
      "submitted:done",
      "fetched:current",
      "checks:waiting",
      "scored:waiting",
      "decision:waiting",
      "round:waiting",
      "paid:waiting",
    ]);
  });
  it("rejected by a failed check: the failure, its reason and how to fix it", () => {
    const s = submissionJourney({
      ...base,
      status: "rejected",
      decision: {
        ...base.decision!,
        action: "reject",
        amount: "0",
        scored: false,
        flags: [
          {
            code: "OUT_OF_WINDOW",
            severity: "hard",
            message: "Posted 5 seconds before this round started.",
          },
        ],
      },
    });
    expect(s[2]).toMatchObject({ key: "checks", state: "failed", label: "Outside the round" });
    expect(s[2]!.fix).toMatch(/after the current round started/);
    expect(s.slice(3).map((x) => x.state)).toEqual(["skipped", "failed", "skipped", "skipped"]);
  });
  it("escalated injection waits on the team", () => {
    const s = submissionJourney({
      ...base,
      status: "escalated",
      decision: {
        ...base.decision!,
        action: "escalate",
        amount: "120000",
        flags: [
          {
            code: "PROMPT_INJECTION_ATTEMPT",
            severity: "soft",
            message: "Contains text aimed at the grader.",
          },
        ],
      },
    });
    expect(s[2]).toMatchObject({ state: "current", label: "Text aimed at the grader" });
    expect(s[4]).toMatchObject({ state: "current", detail: "The agent recommends 0.12 USDC" });
  });
});

describe("escalated with a hard flag", () => {
  it("waits on the team instead of showing a failure", () => {
    const s = submissionJourney({
      ...base,
      status: "escalated",
      decision: {
        ...base.decision!,
        action: "escalate",
        flags: [{ code: "PROMPT_INJECTION_ATTEMPT", severity: "hard", message: "m" }],
      },
    });
    expect(s[2]).toMatchObject({ key: "checks", state: "current" });
  });
});

describe("reasoningChecks", () => {
  it("passes read as plain facts, including the duplicate count from the summary", () => {
    const c = reasoningChecks(
      [],
      "x_post",
      "Approved. No duplicate found across 4 prior submissions.",
    );
    expect(c.map((x) => `${x.state} ${x.label}`)).toEqual([
      "pass Posted by the linked account",
      "pass Inside the round",
      "pass No duplicate across 4 submissions",
      "pass No instructions aimed at the grader",
    ]);
  });
  it("flags replace their group's pass line; extra flags are appended", () => {
    const c = reasoningChecks(
      [
        { code: "PROMPT_INJECTION_ATTEMPT", severity: "soft", message: "m" },
        { code: "NEW_ACCOUNT", severity: "soft", message: "n" },
      ],
      "github_pr",
      "",
    );
    expect(c.map((x) => `${x.state} ${x.label}`)).toEqual([
      "pass Authored by the connected GitHub account",
      "pass Inside the round",
      "pass No duplicate found",
      "warn Injection detected",
      "warn New X account",
    ]);
  });
});

describe("scores and board", () => {
  it("scores follow the rubric's order and names", () => {
    expect(
      scoreLines({ clarity: 7, depth: 8 }, [
        { key: "depth", name: "Depth" },
        { key: "clarity", name: "Clarity" },
      ]),
    ).toEqual([
      { key: "depth", name: "Depth", score: 8 },
      { key: "clarity", name: "Clarity", score: 7 },
    ]);
  });
  it("statuses map to board stages", () => {
    expect(["escalated", "pending", "partial", "paid", "rejected"].map(boardStage)).toEqual([
      "needs",
      "processing",
      "approved",
      "paid",
      "rejected",
    ]);
  });
});
