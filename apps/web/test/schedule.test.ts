import { auditEvents, rounds, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { ProgramInput } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertWalletUser } from "@/lib/server/contributors";
import { createProgram } from "@/lib/server/programs";
import { startRoundNow, updateSchedule } from "@/lib/server/schedule";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-10-02T14:30:00Z");

async function setup(firstRoundStartsAt: Date) {
  const owner = await upsertWalletUser(db, "0x00000000000000000000000000000000000000aa");
  const input = ProgramInput.parse({
    context: {
      about: "A test program for builders on Arc: posts and pull requests about USDC gas.",
    },
    basics: {
      name: "Kency Arc Creators",
      slug: "kency-arc-creators",
      description: "Pays creators.",
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
      ],
    },
    budget: {
      ratePerPoint: "0.5",
      roundLengthDays: "7",
      firstRoundStartsAt: firstRoundStartsAt.toISOString(),
      autoApproveConfidence: "0.8",
      maxAutoApproveItem: "5",
      minAccountAgeDays: "0",
    },
    limits: {
      maxPerPayout: "15",
      maxPerRound: "150",
      maxPerDay: "300",
      autoApproveThreshold: "50",
      payeeCooldownHours: "24",
    },
  });
  const r = await createProgram(db, { ownerUserId: owner.id, chain: "arc-testnet", input });
  if (!r.ok) throw new Error("setup");
  programId = r.programId;
}
const round1 = async () =>
  (await db.select().from(rounds).where(eq(rounds.programId, programId)))[0]!;
const actions = async () =>
  (await db.select().from(auditEvents).where(eq(auditEvents.programId, programId))).map(
    (a) => a.action,
  );

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
});
afterEach(async () => {
  await ctx.client.close();
});

describe("round schedule", () => {
  it("starts a scheduled round now, keeps its length, and audits it (the kency-arc-creators case)", async () => {
    await setup(new Date(NOW.getTime() + 6 * DAY));
    const res = await startRoundNow(db, { programId, actor: "user:x", now: NOW });
    expect(res).toMatchObject({ ok: true, round: { number: 1, startsAt: NOW } });
    const r = await round1();
    expect(r.startsAt.toISOString()).toBe(NOW.toISOString());
    expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(7 * DAY);
    expect(await actions()).toContain("round.started_early");
  });

  it("refuses to start a round that has already started", async () => {
    await setup(new Date(NOW.getTime() - DAY));
    expect(await startRoundNow(db, { programId, actor: "user:x", now: NOW })).toEqual({
      ok: false,
      error: "Round 1 has already started.",
    });
  });

  it("reschedules a round that hasn't started and changes the length; audited", async () => {
    await setup(new Date(NOW.getTime() + 6 * DAY));
    const start = new Date(NOW.getTime() + 2 * 3600 * 1000);
    const res = await updateSchedule(db, {
      programId,
      actor: "user:x",
      roundLengthDays: 14,
      startsAt: start,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    const r = await round1();
    expect(r.startsAt.toISOString()).toBe(start.toISOString());
    expect(r.endsAt.getTime() - start.getTime()).toBe(14 * DAY);
    expect(await actions()).toContain("program.schedule_updated");
  });

  it("a running round keeps its end; only later rounds get the new length", async () => {
    await setup(new Date(NOW.getTime() - DAY));
    const before = await round1();
    expect(
      (await updateSchedule(db, { programId, actor: "user:x", roundLengthDays: 3, now: NOW })).ok,
    ).toBe(true);
    expect((await round1()).endsAt.toISOString()).toBe(before.endsAt.toISOString());
    expect(
      await updateSchedule(db, {
        programId,
        actor: "user:x",
        roundLengthDays: 3,
        startsAt: NOW,
        now: NOW,
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects a start time in the past and lengths outside 1–90 days", async () => {
    await setup(new Date(NOW.getTime() + DAY));
    expect(
      await updateSchedule(db, {
        programId,
        actor: "user:x",
        roundLengthDays: 7,
        startsAt: new Date(NOW.getTime() - DAY),
        now: NOW,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await updateSchedule(db, { programId, actor: "user:x", roundLengthDays: 0, now: NOW }),
    ).toMatchObject({ ok: false });
  });
});
