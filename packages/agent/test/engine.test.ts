import { describe, expect, it } from "vitest";
import { computeAmount, decide, type EngineInput } from "../src/engine";
import { explain } from "../src/explain";
import type { JudgmentOutput } from "../src/judge";
import type { Flag, Resource } from "../src/types";
import { CATEGORIES } from "./helpers";

const USDC = 1_000_000n;
const resource = { sourceType: "x_post", github: undefined } as unknown as Resource;
const J = (o: Partial<JudgmentOutput> = {}): JudgmentOutput => ({
  category: "threads",
  rubric_scores: { depth: 8, clarity: 7, originality: 9 },
  total_points: 8,
  quality_summary: "Clear thread on USDC gas.",
  reasons: ["Specific."],
  soft_flags: [],
  confidence: 0.9,
  recommended_action: "approve",
  ...o,
});
const flag = (code: Flag["code"], severity: Flag["severity"] = "hard"): Flag => ({
  code,
  severity,
  message: `${code} message.`,
  evidence: {},
});
const input = (o: Partial<EngineInput> = {}): EngineInput => ({
  flags: [],
  judgment: J(),
  categories: CATEGORIES,
  resource,
  ratePerPoint: 2n * USDC,
  autoApproveConfidence: 0.8,
  maxPerPayout: 50n * USDC,
  maxAutoApproveItem: 20n * USDC,
  ...o,
});

describe("computeAmount", () => {
  it("prices points × rate exactly, floored to base units", () => {
    // threads: max 10 points, (8+7+9)/30 = 0.8 → 8.00 points × 2 USDC = 16 USDC
    expect(
      computeAmount(CATEGORIES[0]!, { depth: 8, clarity: 7, originality: 9 }, 2n * USDC),
    ).toEqual({ amount: 16n * USDC, points: "8.00" });
    // (7+7+7)/30 × 10 = 7.00; (1+0+0)/30 × 10 = 0.333… → 0.33 points, 666,666 units
    expect(
      computeAmount(CATEGORIES[0]!, { depth: 1, clarity: 0, originality: 0 }, 2n * USDC),
    ).toEqual({ amount: 666_666n, points: "0.33" });
  });

  it("never exceeds the rubric maximum even if a score is out of range", () => {
    expect(
      computeAmount(CATEGORIES[0]!, { depth: 99, clarity: 10, originality: 10 }, 2n * USDC).amount,
    ).toBe(20n * USDC);
  });
});

describe("decide", () => {
  it.each([
    "DELETED",
    "OWNERSHIP_MISMATCH",
    "DUPLICATE_URL",
    "OUT_OF_WINDOW",
    "NEAR_DUPLICATE",
    "NOT_MERGED",
  ] as const)("R1: %s rejects with 0, whatever the model says", (code) => {
    const d = decide(
      input({
        flags: [flag(code)],
        judgment: J({ confidence: 1, rubric_scores: { depth: 10, clarity: 10, originality: 10 } }),
      }),
    );
    expect(d).toMatchObject({ action: "reject", amount: 0n, rule: "R1_REJECT_FLAG", auto: true });
  });

  it("R2: injection always escalates, never auto-approves, even when the model was fooled", () => {
    const fooled = J({
      rubric_scores: { depth: 10, clarity: 10, originality: 10 },
      confidence: 0.99,
      recommended_action: "approve",
    });
    const d = decide(
      input({
        flags: [flag("PROMPT_INJECTION_ATTEMPT")],
        judgment: fooled,
        maxAutoApproveItem: 1000n * USDC,
      }),
    );
    expect(d).toMatchObject({ action: "escalate", rule: "R2_INJECTION", auto: false });
    expect(d.amount).toBe(20n * USDC); // recommendation is pre-filled for the reviewer, not paid
  });

  it("R2 holds for every combination of confidence and amount", () => {
    for (const confidence of [0, 0.5, 0.8, 1]) {
      for (const cap of [0n, 20n * USDC, 10_000n * USDC]) {
        const d = decide(
          input({
            flags: [flag("PROMPT_INJECTION_ATTEMPT")],
            judgment: J({ confidence }),
            maxAutoApproveItem: cap,
          }),
        );
        expect(d.action).toBe("escalate");
      }
    }
  });

  it("R3: no judgment escalates", () => {
    expect(decide(input({ judgment: null, judgeError: "timeout" }))).toMatchObject({
      action: "escalate",
      rule: "R3_NO_JUDGMENT",
      amount: 0n,
    });
  });

  it("R4: a category that doesn't accept this source escalates", () => {
    expect(
      decide(
        input({
          judgment: J({ category: "pull_requests", rubric_scores: { impact: 9, quality: 9 } }),
        }),
      ).rule,
    ).toBe("R4_CATEGORY_INVALID");
  });

  const spam = (o: Partial<JudgmentOutput> = {}) =>
    J({
      recommended_action: "reject",
      confidence: 0.95,
      rubric_scores: { depth: 0, clarity: 1, originality: 0 },
      ...o,
    });

  it("R5a: clear spam (reject, confidence ≥ 0.9, every score ≤ 1) is rejected automatically with 0", () => {
    expect(decide(input({ judgment: spam() }))).toMatchObject({
      action: "reject",
      amount: 0n,
      rule: "R5A_CLEAR_SPAM",
      auto: true,
    });
    // soft flags don't save spam
    expect(decide(input({ judgment: spam(), flags: [flag("NEW_ACCOUNT", "soft")] })).rule).toBe(
      "R5A_CLEAR_SPAM",
    );
  });

  it("R5a boundaries: confidence 0.89, any score of 2, or a non-reject recommendation go to a reviewer", () => {
    expect(decide(input({ judgment: spam({ confidence: 0.89 }) })).rule).toBe(
      "R5_AGENT_RECOMMENDS_REVIEW",
    );
    expect(decide(input({ judgment: spam({ confidence: 0.9 }) })).rule).toBe("R5A_CLEAR_SPAM");
    expect(
      decide(input({ judgment: spam({ rubric_scores: { depth: 2, clarity: 0, originality: 0 } }) }))
        .rule,
    ).toBe("R5_AGENT_RECOMMENDS_REVIEW");
    expect(decide(input({ judgment: spam({ recommended_action: "escalate" }) })).rule).toBe(
      "R5_AGENT_RECOMMENDS_REVIEW",
    );
  });

  it("R5a never overrides prompt injection: those still go to a human", () => {
    expect(
      decide(input({ judgment: spam(), flags: [flag("PROMPT_INJECTION_ATTEMPT")] })).rule,
    ).toBe("R2_INJECTION");
  });

  it("R5: the model recommending reject or escalate goes to a reviewer with its recommendation", () => {
    expect(decide(input({ judgment: J({ recommended_action: "reject" }) })).rule).toBe(
      "R5_AGENT_RECOMMENDS_REVIEW",
    );
    expect(decide(input({ judgment: J({ recommended_action: "escalate" }) })).rule).toBe(
      "R5_AGENT_RECOMMENDS_REVIEW",
    );
  });

  it.each([
    "NEW_ACCOUNT",
    "ENGAGEMENT_ANOMALY",
    "OWNERSHIP_UNVERIFIED",
    "DATE_UNVERIFIED",
    "WALLET_CHANGED_RECENTLY",
    "FETCH_FAILED",
  ] as const)("R6: soft flag %s blocks auto-approval", (code) =>
    expect(decide(input({ flags: [flag(code, "soft")] }))).toMatchObject({
      action: "escalate",
      rule: "R6_SOFT_FLAGS",
    }),
  );

  it("R6: a soft (own-work) NEAR_DUPLICATE escalates instead of rejecting", () => {
    expect(decide(input({ flags: [flag("NEAR_DUPLICATE", "soft")] })).rule).toBe("R6_SOFT_FLAGS");
  });

  it("R7: confidence below the program threshold escalates; at the threshold approves", () => {
    expect(decide(input({ judgment: J({ confidence: 0.79 }) })).rule).toBe("R7_LOW_CONFIDENCE");
    expect(decide(input({ judgment: J({ confidence: 0.8 }) })).action).toBe("approve");
  });

  it("R8: zero points escalates", () => {
    expect(
      decide(input({ judgment: J({ rubric_scores: { depth: 0, clarity: 0, originality: 0 } }) }))
        .rule,
    ).toBe("R8_ZERO_AMOUNT");
  });

  it("R9: above the per-item auto cap escalates; at the cap approves", () => {
    expect(decide(input({ maxAutoApproveItem: 15n * USDC })).rule).toBe("R9_ABOVE_AUTO_CAP");
    expect(decide(input({ maxAutoApproveItem: 16n * USDC })).action).toBe("approve");
  });

  it("R10: approves (or partially approves) automatically when everything holds", () => {
    expect(decide(input())).toMatchObject({
      action: "approve",
      amount: 16n * USDC,
      points: "8.00",
      categoryKey: "threads",
      rule: "R10_AUTO_APPROVE",
      auto: true,
    });
    expect(decide(input({ judgment: J({ recommended_action: "partial" }) })).action).toBe(
      "partial",
    );
  });

  it("caps the amount at the vault's maxPerPayout", () => {
    const d = decide(input({ maxPerPayout: 10n * USDC, maxAutoApproveItem: 100n * USDC }));
    expect(d).toMatchObject({ action: "approve", amount: 10n * USDC, cappedBy: "maxPerPayout" });
  });

  it("adds NOT_MERGED after judgment when the chosen category requires merging", () => {
    const pr = {
      sourceType: "github_pr",
      github: { merged: false, state: "open" },
    } as unknown as Resource;
    const d = decide(
      input({
        resource: pr,
        judgment: J({ category: "pull_requests", rubric_scores: { impact: 9, quality: 9 } }),
      }),
    );
    expect(d).toMatchObject({ action: "reject", amount: 0n, rule: "R1_REJECT_FLAG" });
    expect(d.addedFlags.map((f) => f.code)).toEqual(["NOT_MERGED"]);
  });
});

describe("explain", () => {
  const res = { sourceType: "x_post" } as Resource;
  it("approved: amount, provenance, summary, scores and duplicate coverage", () => {
    const d = decide(input());
    expect(
      explain({
        decision: d,
        flags: [],
        judgment: J(),
        categories: CATEGORIES,
        resource: res,
        priorCount: 412,
      }),
    ).toBe(
      "Approved · 16.00 USDC. Posted inside the round by the linked account. Clear thread on USDC gas. Scored 8/10 on depth, 7/10 on clarity and 9/10 on originality. No duplicate found across 412 prior submissions.",
    );
  });

  it("rejected: leads with the deciding fact", () => {
    const f: Flag = {
      code: "NEAR_DUPLICATE",
      severity: "hard",
      message: "91% identical to a submission by @bob_copies on 2026-10-06.",
      evidence: {},
    };
    const d = decide(input({ flags: [f] }));
    expect(
      explain({
        decision: d,
        flags: [f],
        judgment: null,
        categories: CATEGORIES,
        resource: res,
        priorCount: 3,
      }),
    ).toBe(
      "Rejected. 91% identical to a submission by @bob_copies on 2026-10-06. Recycled content isn't paid under this program's rules.",
    );
  });

  it("clear spam: says it was automatic and can be overridden", () => {
    const j = J({
      recommended_action: "reject",
      confidence: 0.99,
      rubric_scores: { depth: 0, clarity: 0, originality: 0 },
      quality_summary: "A casual personal post with no educational content.",
    });
    const d = decide(input({ judgment: j }));
    expect(
      explain({
        decision: d,
        flags: [],
        judgment: j,
        categories: CATEGORIES,
        resource: res,
        priorCount: 0,
      }),
    ).toBe(
      "Rejected automatically as clearly outside this program's rubric. A casual personal post with no educational content. Scored 0/10 on depth, 0/10 on clarity and 0/10 on originality. The program team can override this decision.",
    );
  });

  it("escalated injection: says why and pre-fills the recommendation", () => {
    const f: Flag = {
      code: "PROMPT_INJECTION_ATTEMPT",
      severity: "hard",
      message: 'Contains text aimed at the grader ("ignore all previous instructions").',
      evidence: {},
    };
    const d = decide(input({ flags: [f] }));
    const text = explain({
      decision: d,
      flags: [f],
      judgment: J(),
      categories: CATEGORIES,
      resource: res,
      priorCount: 0,
    });
    expect(text).toMatch(
      /^Escalated for review\. Contains text aimed at the grader .* always get a human review\. The agent recommends 16\.00 USDC\./,
    );
  });
});
