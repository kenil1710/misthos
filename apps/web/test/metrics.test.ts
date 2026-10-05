import {
  apiUsage,
  contributors,
  decisions,
  payouts,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { Rubric } from "@misthos/shared";
import { keccak256, toBytes } from "viem";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeMetrics } from "@/lib/server/metrics";
import { publicDecisions, publicStats } from "@/lib/server/public";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let real: string;
let demo: string;
let n = 0;

async function program(isDemo: boolean) {
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: `0x${String(++n).padStart(40, "0")}` })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: `p-${n}-x`,
      name: "P",
      description: "Program",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      isDemo,
      vaultAddress: `0x${String(n).padStart(40, "f")}`,
      rubricJson: Rubric.parse({
        categories: [
          {
            key: "posts",
            name: "Posts",
            description: "Posts about Arc",
            sourceTypes: ["x_post"],
            maxPoints: 10,
            criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
          },
        ],
      }),
      ratePerPoint: 1n,
      limitsJson: {
        maxPerPayout: "1",
        maxPerRound: "1",
        maxPerDay: "1",
        autoApproveThreshold: "0",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "0",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: new Date(),
    })
    .returning();
  const [r] = await db
    .insert(rounds)
    .values({
      programId: p!.id,
      number: 1,
      startsAt: new Date(),
      endsAt: new Date(),
      status: "executed",
    })
    .returning();
  const [u] = await db
    .insert(users)
    .values({ xUserId: `x${n}`, xHandle: `h${n}` })
    .returning();
  const [c] = await db
    .insert(contributors)
    .values({ programId: p!.id, userId: u!.id, xUserId: `x${n}`, xHandle: `h${n}` })
    .returning();
  // one auto-approved and paid, one rejected as copied, one escalated injection
  const mk = async (
    rule: string,
    action: "approve" | "reject" | "escalate",
    flags: object[],
    status: "paid" | "rejected" | "escalated",
  ) => {
    const [s] = await db
      .insert(submissions)
      .values({
        programId: p!.id,
        roundId: r!.id,
        contributorId: c!.id,
        url: `u${++n}`,
        sourceType: "x_post",
        resourceId: `${n}`,
        status,
        amount: 2_000_000n,
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning();
    await db.insert(decisions).values({
      submissionId: s!.id,
      flagsJson: flags,
      action,
      amount: 0n,
      summary: "s",
      decisionJson: JSON.stringify({ rule }),
      decisionHash: keccak256(toBytes(`d${n}`)),
      signature: "0x",
      signerAddress: "0x",
      ruleVersion: "rules-v2",
      decidedBy: "agent",
    });
  };
  await mk("R10_AUTO_APPROVE", "approve", [], "paid");
  await mk("R1_REJECT_FLAG", "reject", [{ code: "NEAR_DUPLICATE", severity: "hard" }], "rejected");
  await mk(
    "R2_INJECTION",
    "escalate",
    [{ code: "PROMPT_INJECTION_ATTEMPT", severity: "hard" }],
    "escalated",
  );
  await db.insert(payouts).values({
    roundId: r!.id,
    contributorId: c!.id,
    payoutIdBytes32: keccak256(toBytes(`p${n}`)),
    toAddress: "0x",
    amount: 2_000_000n,
    decisionHash: "0x",
    status: "executed",
    txHash: "0x1",
  });
  await db
    .insert(apiUsage)
    .values({ provider: "x", endpoint: "e", units: 1, estCostUsd: "0.015000", programId: p!.id });
  return p!.id;
}

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  real = await program(false);
  demo = await program(true);
});
afterEach(async () => {
  await ctx.client.close();
});

describe("computeMetrics", () => {
  it("counts real programs only and never demo data", async () => {
    const m = await computeMetrics(db);
    expect(m).toMatchObject({
      programsOnboarded: 1,
      contributors: 1,
      submissionsReviewed: 3,
      usdcPaidTestnet: 2_000_000n,
      usdcPaidMainnet: 0n,
      contributorsPaid: 1,
      roundsExecuted: 1,
      xCalls: 1,
      fraudByFlag: { NEAR_DUPLICATE: 1, PROMPT_INJECTION_ATTEMPT: 1 },
    });
    expect(m.autoApprovedPct).toBeCloseTo(1 / 3);
    expect(m.escalatedPct).toBeCloseTo(1 / 3);
    expect(m.xSpendUsd).toBeCloseTo(0.015);
    expect(m.medianReviewSeconds).toBeGreaterThan(0);
  });

  it("is all zeros when only demo programs exist", async () => {
    const { programs: p } = await import("@misthos/db");
    const { eq } = await import("drizzle-orm");
    await db.update(p).set({ isDemo: true }).where(eq(p.id, real));
    const m = await computeMetrics(db);
    expect(m).toMatchObject({
      programsOnboarded: 0,
      submissionsReviewed: 0,
      usdcPaidTestnet: 0n,
      fraudByFlag: {},
      autoApprovedPct: null,
      medianReviewSeconds: null,
    });
  });
});

describe("publicStats", () => {
  it("summarizes one program (demo programs still have their own public page)", async () => {
    expect(await publicStats(demo, db)).toEqual({
      usdcPaid: 2_000_000n,
      contributorsPaid: 1,
      reviewed: 3,
      fraudCaught: 2,
      roundsPaid: 1,
    });
  });
});

describe("fraud and current decisions", () => {
  async function addSubmission(
    programId: string,
    status: "rejected" | "paid",
    flags: object[],
    action: "approve" | "reject" | "escalate",
    at: Date,
  ) {
    const [r] = await db.select().from(rounds).limit(1);
    const [c] = await db.select().from(contributors).limit(1);
    const [s] = await db
      .insert(submissions)
      .values({
        programId,
        roundId: r!.id,
        contributorId: c!.id,
        url: `u${++n}`,
        sourceType: "x_post",
        resourceId: `${n}`,
        status,
      })
      .returning();
    const decide = async (a: typeof action, f: object[], when: Date) =>
      db.insert(decisions).values({
        submissionId: s!.id,
        flagsJson: f,
        action: a,
        amount: 0n,
        summary: a,
        decisionJson: "{}",
        decisionHash: keccak256(toBytes(`d${++n}`)),
        signature: "0x",
        signerAddress: "0x",
        ruleVersion: "rules-v3",
        decidedBy: "agent",
        createdAt: when,
      });
    await decide(action, flags, at);
    return { id: s!.id, decide };
  }

  it("doesn't count late work as fraud (out of window, with a soft own-work similarity)", async () => {
    await addSubmission(
      real,
      "rejected",
      [
        { code: "OUT_OF_WINDOW", severity: "hard" },
        { code: "NEAR_DUPLICATE", severity: "soft" },
      ],
      "reject",
      new Date(),
    );
    expect((await publicStats(real, db)).fraudCaught).toBe(2);
    expect((await computeMetrics(db)).fraudByFlag).toEqual({
      NEAR_DUPLICATE: 1,
      PROMPT_INJECTION_ATTEMPT: 1,
    });
  });

  it("shows only each submission's current decision, never a superseded one", async () => {
    const s = await addSubmission(real, "paid", [], "escalate", new Date(Date.now() - 3_600_000));
    await s.decide("approve", [], new Date());
    const shown = (await publicDecisions(real, 25, db)).filter(
      (d) => d.summary === "escalate" || d.summary === "approve",
    );
    expect(shown.map((d) => d.action)).toEqual(["approve"]);
  });
});

describe("metrics count each submission once (F-11)", () => {
  it("a re-processed submission and drafts don't inflate the numbers", async () => {
    const before = await computeMetrics(db);
    // Re-process the paid submission: a second agent decision for the same submission.
    const [d] = await db.select().from(decisions).where(eq(decisions.action, "approve")).limit(1);
    await db.insert(decisions).values({
      ...d!,
      id: undefined,
      decisionHash: keccak256(toBytes(`reprocessed${n}`)),
      createdAt: new Date(Date.now() + 1000),
    } as never);
    // A draft program with no vault (someone trying the wizard) isn't a real program.
    const [o] = await db.select().from(programs).limit(1);
    await db.insert(programs).values({
      ...o!,
      id: undefined,
      slug: `draft-${n}`,
      status: "draft",
      vaultAddress: null,
      isDemo: false,
    } as never);
    const after = await computeMetrics(db);
    expect(after.submissionsReviewed).toBe(before.submissionsReviewed);
    expect(after.programsOnboarded).toBe(before.programsOnboarded);
  });
});
