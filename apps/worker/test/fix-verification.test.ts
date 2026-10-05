/**
 * Fix verification (docs/FIX_VERIFICATION.md). V-10 started as a repro of N-7 and is now its regression test.
 */
import { programs, rounds, users, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { QUEUES, roundJobKey, Rubric } from "@misthos/shared";
import { sql } from "drizzle-orm";
import { fromPglite, PgBoss } from "pg-boss";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQueues, recoverRounds } from "../src/jobs";

const log = pino({ level: "silent" });
let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let boss: PgBoss;

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
      vaultAddress: "0x000000000000000000000000000000000000f00d",
      rubricJson: Rubric.parse({
        categories: [
          {
            key: "posts",
            name: "Posts",
            description: "Posts",
            sourceTypes: ["x_post"],
            maxPoints: 10,
            criteria: [{ key: "depth", name: "Depth", description: "Explains how" }],
          },
        ],
      }),
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
  // A round waiting for the owner (status proposed): every pass re-enqueues it.
  await db.insert(rounds).values({
    programId: p!.id,
    number: 1,
    status: "proposed",
    startsAt: new Date("2026-10-05T00:00:00Z"),
    endsAt: new Date("2026-10-19T00:00:00Z"),
  });
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

describe("FIX VERIFICATION: worker (regressions)", () => {
  it("V-10 (N-7): one queued job per round, however many passes or senders ask for it", async () => {
    await createQueues(boss, { concurrency: 1 });
    const fakeDeps = { db } as unknown as Parameters<typeof recoverRounds>[1];
    for (let i = 0; i < 3; i++) await recoverRounds(boss, fakeDeps, log); // three passes, no drain in between
    // The owner's approval (web app) uses the same key: still one job.
    const [r] = await db.select().from(rounds);
    expect(
      await boss.send(
        QUEUES.runRound,
        { roundId: r!.id, force: false },
        { singletonKey: roundJobKey(r!.id) },
      ),
    ).toBeNull();
    const res = (await db.execute(
      sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.runRound} and state = 'created'`,
    )) as unknown as { rows: { n: number }[] };
    expect(res.rows[0]!.n).toBe(1);
  });
});
