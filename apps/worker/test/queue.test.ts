import { eoaSigner, FetchError, type Judge, type Resource, type RoundDeps } from "@misthos/agent";
import { FakeVault } from "../../../packages/agent/test/fake-vault";
import {
  contributors,
  decisions,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { PRODUCER_OPTIONS, QUEUE_SCHEMA, QUEUES, roundJobKey, Rubric } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { fromPglite, PgBoss } from "pg-boss";
import pino from "pino";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueues, recoverRounds, runDrain } from "../src/jobs";
import { createRunner, runnerIsHealthy } from "../src/runner";

/**
 * The real pg-boss queue (PGlite backend, in-process) driving the real pipeline: enqueue → worker → signed decision.
 * Fetchers and judge are stubs; the network is never touched.
 */
const log = pino({ level: "silent" });
const RUBRIC = Rubric.parse({
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
});
const resource: Resource = {
  sourceType: "x_post",
  resourceId: "777",
  url: "https://x.com/alice/status/777",
  timestamp: "2026-10-06T10:00:00.000Z",
  timestampKind: "posted",
  title: null,
  text: "A clear explanation of why Arc quotes gas in USDC and how 6-decimal accounting avoids rounding bugs in payroll.",
  author: {
    id: "42",
    handle: "alice",
    name: null,
    createdAt: "2020-01-01T00:00:00Z",
    followers: 500,
  },
  x: {
    isRepost: false,
    isReply: false,
    isQuote: false,
    likes: 10,
    reposts: 1,
    replies: 0,
    quotes: 0,
    impressions: 900,
    lang: "en",
  },
};
const judge: Judge = async () => ({
  output: {
    category: "posts",
    rubric_scores: { depth: 8 },
    total_points: 8,
    quality_summary: "Clear and specific.",
    reasons: ["Specific."],
    soft_flags: [],
    confidence: 0.9,
    recommended_action: "approve",
  },
  model: "stub",
  promptVersion: "judge-v2",
  usage: { provider: "anthropic", endpoint: "POST /v1/messages", units: 1, estCostUsd: 0 },
});

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let boss: PgBoss;
let submissionId: string;

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "q",
      name: "Q",
      description: "Queue test",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      rubricJson: RUBRIC,
      ratePerPoint: 1_000_000n,
      limitsJson: {
        maxPerPayout: "50000000",
        maxPerRound: "500000000",
        maxPerDay: "1000000000",
        autoApproveThreshold: "0",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "20000000",
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 14,
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  await db.insert(programMembers).values({ programId: p!.id, userId: owner!.id, role: "owner" });
  const [r] = await db
    .insert(rounds)
    .values({
      programId: p!.id,
      number: 1,
      startsAt: new Date("2026-10-05T00:00:00Z"),
      endsAt: new Date("2026-10-19T00:00:00Z"),
    })
    .returning();
  const [u] = await db.insert(users).values({ xUserId: "42", xHandle: "alice" }).returning();
  const [c] = await db
    .insert(contributors)
    .values({
      programId: p!.id,
      userId: u!.id,
      xUserId: "42",
      xHandle: "alice",
      walletAddress: `0x${"b1".padStart(40, "0")}`,
      walletVerifiedAt: new Date(),
    })
    .returning();
  const [s] = await db
    .insert(submissions)
    .values({
      programId: p!.id,
      roundId: r!.id,
      contributorId: c!.id,
      url: resource.url,
      sourceType: "x_post",
      resourceId: "777",
      createdAt: new Date("2026-10-07T00:00:00Z"),
    })
    .returning();
  submissionId = s!.id;
  boss = new PgBoss({
    db: fromPglite(ctx.client),
    backend: "pglite",
    schema: "pgboss",
    supervise: false,
    schedule: false,
  });
  await boss.start();
});
afterEach(async () => {
  await boss.stop({ graceful: false, timeout: 1000 });
  await ctx.client.close();
});

const fakeVault = () =>
  new FakeVault(
    {
      maxPerPayout: 50_000_000n,
      maxPerRound: 500_000_000n,
      maxPerDay: 1_000_000_000n,
      autoApproveThreshold: 100_000_000n,
      payeeCooldown: 0n,
    },
    1_000_000_000n,
  );

function deps(x: RoundDeps["fetchers"]["x"], vault = fakeVault()): RoundDeps {
  const unused = async () => {
    throw new Error("unused");
  };
  return {
    db,
    judge,
    signer: eoaSigner(generatePrivateKey()),
    chainId: 5042002,
    fetchers: { x, githubPr: unused, githubCommit: unused, article: unused },
    reader: vault,
    executor: vault,
  };
}

const statusOf = async () =>
  (await db.select().from(submissions).where(eq(submissions.id, submissionId)))[0]!;
const opts = { concurrency: 1 };
const drain = (d: RoundDeps, o: Partial<Parameters<typeof runDrain>[3]> = {}) =>
  runDrain(boss, d, log, { ...opts, ...o });

describe("queue → drain → decision (no polling)", () => {
  it("processes an enqueued submission into a signed decision in one drain", async () => {
    await createQueues(boss, opts);
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    const res = await drain(deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })));
    expect(res.processed).toBeGreaterThanOrEqual(1);
    const s = await statusOf();
    expect(s).toMatchObject({ status: "approved", amount: 8_000_000n });
    expect(
      await db.select().from(decisions).where(eq(decisions.submissionId, submissionId)),
    ).toHaveLength(1);
    expect(res.nextDueAt).toBeNull();
  });

  it("accepts jobs from a producer configured exactly like the web app", async () => {
    await createQueues(boss, opts);
    const producer = new PgBoss({
      ...PRODUCER_OPTIONS,
      db: fromPglite(ctx.client),
      backend: "pglite",
    });
    await producer.start();
    expect(
      await producer.send(
        QUEUES.processSubmission,
        { submissionId },
        { singletonKey: submissionId },
      ),
    ).toBeTruthy();
    await producer.stop({ graceful: false, timeout: 1000 });
    await drain(deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })));
    expect((await statusOf()).status).toBe("approved");
  });

  it("a transient failure is retried by a later drain; the drain says when it's due", async () => {
    const x = vi
      .fn()
      .mockRejectedValueOnce(new FetchError("X API 503", true, 503))
      .mockResolvedValue({ outcome: { status: "ok", resource }, usage: [] });
    await createQueues(boss, { ...opts, retryDelaySeconds: 1 });
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    const first = await drain(deps(x));
    expect((await statusOf()).status).toBe("pending");
    expect(first.nextDueAt).not.toBeNull(); // the runner schedules its own wake-up for this
    await new Promise((r) =>
      setTimeout(r, Math.max(0, first.nextDueAt!.getTime() - Date.now()) + 300),
    );
    await drain(deps(x));
    expect((await statusOf()).status).toBe("approved");
    expect(x).toHaveBeenCalledTimes(2);
  });

  it("runs a payout round end to end: decision → due round found by the drain → paid", async () => {
    const vault = fakeVault();
    const d = deps(async () => ({ outcome: { status: "ok", resource }, usage: [] }), vault);
    await createQueues(boss, opts);
    await db.update(programs).set({ vaultAddress: "0x000000000000000000000000000000000000f00d" });
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    await drain(d);
    expect((await statusOf()).status).toBe("approved");
    // The round ended; the next drain (a tick) finds it and pays it.
    await db.update(rounds).set({ endsAt: new Date(Date.now() - 1000) });
    await drain(d);
    expect((await statusOf()).status).toBe("paid");
    expect(vault.calls).toEqual(["registerPayee", "proposeRound", "executeRound"]);
    const [r] = await db.select().from(rounds).where(eq(rounds.number, 1));
    expect(r).toMatchObject({ status: "executed", totalAmount: 8_000_000n });
  });

  it("F-08: a round left mid-flight or waiting for approval is picked up by every pass, not only at restart; paid once", async () => {
    const vault = fakeVault();
    const d = deps(async () => ({ outcome: { status: "ok", resource }, usage: [] }), vault);
    await createQueues(boss, opts);
    await db.update(programs).set({ vaultAddress: "0x000000000000000000000000000000000000f00d" });
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    await drain(d);
    // A dead worker closed the round and still holds its job (claimed, never completed).
    const [round] = await db.select().from(rounds).where(eq(rounds.number, 1));
    await db.update(rounds).set({ status: "closed", endsAt: new Date(Date.now() - 1000) });
    await boss.send(
      QUEUES.runRound,
      { roundId: round!.id, force: false },
      { singletonKey: roundJobKey(round!.id) },
    );
    const [orphan] = await boss.fetch(QUEUES.runRound);
    expect(orphan).toBeTruthy();
    // While the dead worker's job still counts as active, the round isn't run a second time (one job per round).
    await drain(d);
    expect(vault.calls).not.toContain("proposeRound");
    // pg-boss expires the orphan (supervise, on the next tick within ~15 min); the next pass then pays exactly once.
    await boss.fail(QUEUES.runRound, orphan!.id, { message: "expired" });
    await drain(d);
    expect((await statusOf()).status).toBe("paid");
    await drain(d);
    expect(vault.calls.filter((c) => c === "executeRound")).toHaveLength(1);
  });

  it("F-08: a round awaiting the owner's approval is re-polled until the chain says approved", async () => {
    const vault = fakeVault();
    vault.lim.autoApproveThreshold = 1_000_000n; // 8 USDC needs the owner
    const d = deps(async () => ({ outcome: { status: "ok", resource }, usage: [] }), vault);
    await createQueues(boss, opts);
    await db.update(programs).set({ vaultAddress: "0x000000000000000000000000000000000000f00d" });
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    await drain(d);
    await db.update(rounds).set({ endsAt: new Date(Date.now() - 1000) });
    await drain(d);
    const [r] = await db.select().from(rounds).where(eq(rounds.number, 1));
    expect(r!.status).toBe("proposed");
    // The owner approves on the explorer (the app never hears about it); the next pass notices and pays.
    vault.approve(r!.roundIdBytes32 as `0x${string}`);
    await drain(d);
    expect((await statusOf()).status).toBe("paid");
  });

  it("a finished 'nothing to pay' round isn't recovered over and over", async () => {
    const vault = fakeVault();
    const d = deps(async () => ({ outcome: { status: "ok", resource }, usage: [] }), vault);
    await createQueues(boss, opts);
    await db.update(programs).set({ vaultAddress: "0x000000000000000000000000000000000000f00d" });
    await db.update(submissions).set({ status: "rejected" });
    await db.update(rounds).set({ endsAt: new Date(Date.now() - 1000) });
    await drain(d);
    const [r] = await db.select().from(rounds).where(eq(rounds.number, 1));
    expect(r).toMatchObject({ status: "closed" });
    expect(await recoverRounds(boss, d, log)).toBe(0);
  });

  it("the sweeper picks up a pending submission that never got a job", async () => {
    await createQueues(boss, opts);
    await db
      .update(submissions)
      .set({ updatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(submissions.id, submissionId));
    await drain(deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })));
    expect((await statusOf()).status).toBe("approved");
  });
});

describe("runner", () => {
  it("runs one drain at a time; a wake during a drain runs one more right after", async () => {
    const d = deps(async () => ({ outcome: { status: "ok", resource }, usage: [] }));
    let starts = 0;
    let stops = 0;
    const runner = createRunner({
      makeBoss: () => {
        starts++;
        // The test's boss stays open; count lifecycle calls instead of really starting/stopping it.
        return new Proxy(boss, {
          get(target, prop) {
            if (prop === "start") return async () => target;
            if (prop === "stop")
              return async () => {
                stops++;
              };
            if (prop === "on") return () => target;
            const v = Reflect.get(target, prop, target);
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      },
      deps: d,
      log,
      opts,
      tickMinutes: 15,
    });
    await createQueues(boss, opts);
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    const a = runner.drain("wake");
    const b = runner.drain("wake"); // arrives mid-drain
    await Promise.all([a, b]);
    expect(starts).toBe(2);
    expect(stops).toBe(2); // every drain closes its connection afterwards
    expect((await statusOf()).status).toBe("approved");
    expect(runner.health()).toMatchObject({ lastDrainOk: true, draining: false });
  });

  it("health: stale ticks, failed passes and stuck queues are unhealthy; nothing reads the database", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const base = {
      startedAt: "2026-10-05T10:00:00Z",
      lastDrainAt: "2026-10-05T11:58:00Z",
      lastDrainOk: true,
      lastError: null,
      lastTickAt: "2026-10-05T11:50:00Z",
      oldestQueuedAt: null,
      draining: false,
      tickMinutes: 15,
    };
    expect(runnerIsHealthy(base, now)).toEqual({ ok: true, problem: null });
    expect(runnerIsHealthy({ ...base, lastTickAt: "2026-10-05T11:00:00Z" }, now).ok).toBe(false);
    // N-13: the public verdict never carries internal error text.
    expect(
      runnerIsHealthy(
        { ...base, lastDrainOk: false, lastError: "connect ECONNREFUSED db.internal:5432" },
        now,
      ),
    ).toEqual({ ok: false, problem: "The last pass failed; see the worker logs." });
    expect(runnerIsHealthy({ ...base, oldestQueuedAt: "2026-10-05T11:40:00Z" }, now).ok).toBe(
      false,
    );
  });
});
