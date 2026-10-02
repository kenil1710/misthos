import { contributors, programs, rounds, submissions, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { ProgramInput, QUEUES } from "@misthos/shared";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkContributorWallet, upsertWalletUser, upsertXUser } from "@/lib/server/contributors";
import { createProgram, setProgramStatus } from "@/lib/server/programs";
import { ensureCurrentRound } from "@/lib/server/rounds";
import { createSubmission, DAILY_SUBMISSION_LIMIT } from "@/lib/server/submissions";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let alice: { id: string; xUserId: string; xHandle: string };
const enqueue = vi.fn(async () => true);
const NOW = new Date("2026-10-07T12:00:00Z");

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  enqueue.mockClear();
  const owner = await upsertWalletUser(db, "0x00000000000000000000000000000000000000aa");
  const input = ProgramInput.parse({
    basics: {
      name: "Arc Builders",
      slug: "arc-builders",
      description: "Pays for great Arc content.",
      logoUrl: "",
    },
    rubric: {
      categories: [
        {
          key: "threads",
          name: "Threads",
          description: "Original threads",
          sourceTypes: ["x_post"],
          maxPoints: 10,
          criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
        },
        {
          key: "prs",
          name: "Pull requests",
          description: "Merged code",
          sourceTypes: ["github_pr"],
          maxPoints: 20,
          criteria: [{ key: "impact", name: "Impact", description: "Real fix" }],
        },
      ],
    },
    budget: {
      ratePerPoint: "2",
      roundLengthDays: "7",
      firstRoundStartsAt: "2026-10-05T00:00:00Z",
      autoApproveConfidence: "0.8",
      maxAutoApproveItem: "20",
      minAccountAgeDays: "30",
    },
    limits: {
      maxPerPayout: "50",
      maxPerRound: "500",
      maxPerDay: "1000",
      autoApproveThreshold: "200",
      payeeCooldownHours: "24",
    },
  });
  const r = await createProgram(db, { ownerUserId: owner.id, chain: "arc-testnet", input });
  if (!r.ok) throw new Error("setup");
  programId = r.programId;
  await setProgramStatus(db, { programId, userId: owner.id, status: "active" });
  alice = await upsertXUser(db, { id: "42", username: "alice" });
  await linkContributorWallet(db, {
    programSlug: "arc-builders",
    user: alice,
    address: "0x00000000000000000000000000000000000000b1",
    nonce: "n",
    issuedAt: new Date(),
    signature: "0x01",
    chainId: 5042002,
    verify: async () => true,
    consumeNonce: async () => true,
  });
});
afterEach(async () => {
  await ctx.client.close();
});

const submit = (url: string, over: Partial<Parameters<typeof createSubmission>[1]> = {}) =>
  createSubmission(
    db,
    {
      programSlug: "arc-builders",
      xUserId: alice.xUserId,
      userId: alice.id,
      url,
      now: NOW,
      ...over,
    },
    enqueue,
  );

describe("createSubmission", () => {
  it("records a valid submission in the current round and enqueues it", async () => {
    const r = await submit("https://x.com/alice/status/1840000000000000001");
    expect(r.ok).toBe(true);
    const [s] = await db.select().from(submissions);
    expect(s).toMatchObject({
      sourceType: "x_post",
      resourceId: "1840000000000000001",
      status: "pending",
      url: "https://x.com/i/web/status/1840000000000000001",
    });
    expect(enqueue).toHaveBeenCalledWith(QUEUES.processSubmission, { submissionId: s!.id }, s!.id);
  });

  it.each([
    ["not a link", /full link/],
    ["https://blog.example.com/post", /doesn't pay for articles/],
    ["https://youtu.be/abc", /YouTube/],
  ])("rejects %s instantly", async (url, msg) => {
    const r = await submit(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses GitHub work until GitHub is connected; a typed username doesn't count (spoofing)", async () => {
    const r = await submit("https://github.com/a/b/pull/1");
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Connect your GitHub account/),
    });
    // Someone types another person's username: still refused.
    await db.update(contributors).set({ githubLogin: "torvalds" });
    expect((await submit("https://github.com/a/b/pull/1")).ok).toBe(false);
    // Connected through OAuth (verified id): accepted.
    await db.update(contributors).set({ githubUserId: "4242", githubLogin: "alice-dev" });
    expect((await submit("https://github.com/a/b/pull/1")).ok).toBe(true);
  });

  it("refuses non-members, unverified wallets and paused programs", async () => {
    const bob = await upsertXUser(db, { id: "43", username: "bob" });
    expect(
      await submit("https://x.com/b/status/1", { xUserId: bob.xUserId, userId: bob.id }),
    ).toEqual({ ok: false, error: "Join this program before submitting." });
    await db.update(contributors).set({ walletVerifiedAt: null });
    expect((await submit("https://x.com/a/status/2")).ok).toBe(false);
    await db.update(programs).set({ status: "paused" });
    expect(await submit("https://x.com/a/status/3")).toMatchObject({
      ok: false,
      error: /isn't accepting/,
    });
  });

  it("refuses duplicates of your own live submission but allows resubmitting a rejected one", async () => {
    await submit("https://x.com/alice/status/1840000000000000001");
    expect(await submit("https://twitter.com/alice/status/1840000000000000001?s=20")).toEqual({
      ok: false,
      error: "You've already submitted this.",
    });
    await db.update(submissions).set({ status: "rejected" });
    expect((await submit("https://x.com/alice/status/1840000000000000001")).ok).toBe(true);
  });

  it("enforces the daily limit", async () => {
    for (let i = 0; i < DAILY_SUBMISSION_LIMIT; i++)
      expect((await submit(`https://x.com/a/status/${100 + i}`)).ok).toBe(true);
    expect(await submit("https://x.com/a/status/999")).toMatchObject({
      ok: false,
      error: /up to 20 links per day/,
    });
  });

  it("refuses before round 1 opens", async () => {
    expect(
      await submit("https://x.com/a/status/1", { now: new Date("2026-10-01T00:00:00Z") }),
    ).toMatchObject({ ok: false, error: /Round 1 opens/ });
  });
});

describe("ensureCurrentRound", () => {
  it("opens consecutive rounds lazily as time passes", async () => {
    const program = { id: programId, roundLengthDays: 7 };
    expect((await ensureCurrentRound(db, program, new Date("2026-10-06T00:00:00Z")))?.number).toBe(
      1,
    );
    const r3 = await ensureCurrentRound(db, program, new Date("2026-10-20T00:00:00Z"));
    expect(r3).toMatchObject({
      number: 3,
      startsAt: new Date("2026-10-19T00:00:00Z"),
      endsAt: new Date("2026-10-26T00:00:00Z"),
    });
    const all = await db
      .select()
      .from(rounds)
      .where(eq(rounds.programId, programId))
      .orderBy(asc(rounds.number));
    expect(all.map((r) => r.number)).toEqual([1, 2, 3]);
    // idempotent
    await ensureCurrentRound(db, program, new Date("2026-10-20T00:00:00Z"));
    expect(await db.select().from(rounds).where(eq(rounds.programId, programId))).toHaveLength(3);
  });
});
