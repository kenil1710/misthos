import {
  appeals,
  auditEvents,
  contributors,
  decisions,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { Rubric } from "@misthos/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAILY_APPEALS, requestAppeal } from "@/lib/server/appeals";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let roundId: string;
let alice: { userId: string; contributorId: string };
let bobUserId: string;

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x" + "a".repeat(40) })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "appeals",
      name: "Appeals",
      description: "Second looks",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
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
      ratePerPoint: 1_000_000n,
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
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  programId = p!.id;
  const [r] = await db
    .insert(rounds)
    .values({
      programId,
      number: 1,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 86400_000),
    })
    .returning();
  roundId = r!.id;
  const [u] = await db.insert(users).values({ xUserId: "1", xHandle: "alice" }).returning();
  const [c] = await db
    .insert(contributors)
    .values({ programId, userId: u!.id, xUserId: "1", xHandle: "alice" })
    .returning();
  alice = { userId: u!.id, contributorId: c!.id };
  const [b] = await db.insert(users).values({ xUserId: "2", xHandle: "bob" }).returning();
  bobUserId = b!.id;
});
afterEach(async () => ctx.client.close());

let n = 0;
async function decided(action: "reject" | "partial" | "approve", over: { payoutId?: string } = {}) {
  n++;
  const [s] = await db
    .insert(submissions)
    .values({
      programId,
      roundId,
      contributorId: alice.contributorId,
      url: `https://x.com/alice/status/${n}`,
      sourceType: "x_post",
      resourceId: String(n),
      status: action === "reject" ? "rejected" : action === "partial" ? "partial" : "approved",
      ...over,
    })
    .returning();
  await db.insert(decisions).values({
    submissionId: s!.id,
    flagsJson: [],
    action,
    amount: 0n,
    summary: "x",
    decisionJson: "{}",
    decisionHash: `0x${String(n).padStart(64, "0")}`,
    signature: "0x00",
    signerAddress: "0x" + "1".repeat(40),
    ruleVersion: "rules-v6",
    decidedBy: "agent",
  });
  return s!.id;
}
const ask = (submissionId: string, userId = alice.userId) =>
  requestAppeal(db, { userId, submissionId, note: "It's my own thread from this round." });

describe("Ask for a second look", () => {
  it("records one request per rejected or partial submission, audited with the decision it questions", async () => {
    const id = await decided("reject");
    expect(await ask(id)).toEqual({ ok: true });
    expect(await ask(id)).toMatchObject({ ok: false, status: 409, error: /already asked/ });
    const [a] = await db.select().from(appeals);
    expect(a).toMatchObject({ submissionId: id, decisionHash: `0x${String(n).padStart(64, "0")}` });
    expect((await db.select().from(auditEvents)).map((e) => e.action)).toEqual([
      "appeal.requested",
    ]);
    expect(await ask(await decided("partial"))).toEqual({ ok: true });
  });

  it("refuses approved work, work being paid, and other people's submissions", async () => {
    expect(await ask(await decided("approve"))).toMatchObject({ ok: false, status: 409 });
    const paying = await decided("reject", { payoutId: crypto.randomUUID() });
    expect(await ask(paying)).toMatchObject({ ok: false, error: /already being paid/ });
    expect(await ask(await decided("reject"), bobUserId)).toMatchObject({ ok: false, status: 404 });
  });

  it(`is limited to ${DAILY_APPEALS} a day`, async () => {
    for (let i = 0; i < DAILY_APPEALS; i++)
      expect(await ask(await decided("reject"))).toEqual({ ok: true });
    expect(await ask(await decided("reject"))).toMatchObject({ ok: false, status: 429 });
  });
});
