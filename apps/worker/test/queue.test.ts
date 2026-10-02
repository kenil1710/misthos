import {
  eoaSigner,
  FetchError,
  type Judge,
  type PipelineDeps,
  type Resource,
} from "@misthos/agent";
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
import { PRODUCER_OPTIONS, QUEUE_SCHEMA, QUEUES, Rubric } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { fromPglite, PgBoss } from "pg-boss";
import pino from "pino";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerJobs } from "../src/jobs";

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

function deps(x: PipelineDeps["fetchers"]["x"]): PipelineDeps {
  const unused = async () => {
    throw new Error("unused");
  };
  return {
    db,
    judge,
    signer: eoaSigner(generatePrivateKey()),
    chainId: 5042002,
    fetchers: { x, githubPr: unused, githubCommit: unused, article: unused },
  };
}

async function waitForStatus(status: string, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const [s] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    if (s!.status === status) return s!;
    if (Date.now() > until)
      throw new Error(`timed out waiting for ${status}; last status ${s!.status}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("queue → worker → decision", () => {
  it("processes an enqueued submission into a signed decision", async () => {
    const jobs = await registerJobs(
      boss,
      deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })),
      log,
      { concurrency: 1, sweepIntervalMs: 0 },
    );
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    const s = await waitForStatus("approved");
    expect(s.amount).toBe(8_000_000n);
    expect(
      await db.select().from(decisions).where(eq(decisions.submissionId, submissionId)),
    ).toHaveLength(1);
    jobs.stop();
  });

  it("accepts jobs from a producer configured exactly like the web app", async () => {
    const jobs = await registerJobs(
      boss,
      deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })),
      log,
      { concurrency: 1, sweepIntervalMs: 0 },
    );
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
    await waitForStatus("approved");
    await producer.stop({ graceful: false, timeout: 1000 });
    jobs.stop();
  });

  it("retries a transient fetch failure, then decides", async () => {
    const x = vi
      .fn()
      .mockRejectedValueOnce(new FetchError("X API 503", true, 503))
      .mockResolvedValue({ outcome: { status: "ok", resource }, usage: [] });
    const jobs = await registerJobs(boss, deps(x), log, {
      concurrency: 1,
      retryDelaySeconds: 1,
      sweepIntervalMs: 0,
    });
    await boss.send(QUEUES.processSubmission, { submissionId }, { singletonKey: submissionId });
    await waitForStatus("approved");
    expect(x).toHaveBeenCalledTimes(2);
    jobs.stop();
  });

  it("the sweeper picks up a pending submission that never got a job", async () => {
    const jobs = await registerJobs(
      boss,
      deps(async () => ({ outcome: { status: "ok", resource }, usage: [] })),
      log,
      { concurrency: 1, sweepIntervalMs: 0 },
    );
    await db
      .update(submissions)
      .set({ updatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(submissions.id, submissionId));
    expect(await jobs.sweep()).toBe(1);
    await waitForStatus("approved");
    jobs.stop();
  });
});
