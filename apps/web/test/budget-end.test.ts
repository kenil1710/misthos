import { auditEvents, programs, rounds, submissions, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { ProgramInput } from "@misthos/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetOf, BUDGET_USED_UP_MESSAGE, closedReason, ENDED_MESSAGE } from "@/lib/budget";
import { programBudget } from "@/lib/server/budget";
import { linkContributorWallet, upsertWalletUser, upsertXUser } from "@/lib/server/contributors";
import { openCampaigns } from "@/lib/server/explore";
import { createProgram, endProgram, setProgramStatus } from "@/lib/server/programs";
import { ensureCurrentRound } from "@/lib/server/rounds";
import { createSubmission } from "@/lib/server/submissions";

/** Budget (vault balance − approved, unpaid work) and ending a campaign, on the web side. */
let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let alice: { id: string; xUserId: string; xHandle: string };
let ownerId: string;
const enqueue = vi.fn(async () => true);
const NOW = new Date("2026-10-07T12:00:00Z");

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  enqueue.mockClear();
  const owner = await upsertWalletUser(db, "0x00000000000000000000000000000000000000aa");
  const input = ProgramInput.parse({
    context: {
      about: "A test program for builders on Arc: posts and pull requests about USDC gas.",
    },
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
  ownerId = owner.id;
  const r = await createProgram(db, { ownerUserId: owner.id, chain: "arc-testnet", input });
  if (!r.ok) throw new Error("setup");
  programId = r.programId;
  await setProgramStatus(db, { programId, userId: owner.id, status: "active" });
  await db
    .update(programs)
    .set({ vaultAddress: "0x000000000000000000000000000000000000f00d" })
    .where(eq(programs.id, programId));
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

const USDC = 1_000_000n;
/** The vault, as the submission check reads it. */
let vault: bigint | null = 100n * USDC;
const balanceOf = async () => vault;
const post = (n: number) =>
  `https://x.com/alice/status/18400000000000000${String(n).padStart(2, "0")}`;
const approve = async (amount: bigint) => {
  const [s] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.status, "pending"))
    .limit(1);
  await db.update(submissions).set({ status: "approved", amount }).where(eq(submissions.id, s!.id));
};
const program = async () =>
  (await db.select().from(programs).where(eq(programs.id, programId)))[0]!;

describe("budget rules", () => {
  it("available = balance − approved, unpaid work; used up below one point; unknown never blocks", () => {
    const rate = 2n * USDC;
    expect(
      budgetOf({ balance: 10n * USDC, approvedUnpaid: 4n * USDC, ratePerPoint: rate }),
    ).toEqual({ available: 6n * USDC, usedUp: false });
    expect(
      budgetOf({ balance: 10n * USDC, approvedUnpaid: 9n * USDC, ratePerPoint: rate }).usedUp,
    ).toBe(true);
    expect(budgetOf({ balance: null, approvedUnpaid: 9n * USDC, ratePerPoint: rate })).toEqual({
      available: null,
      usedUp: false,
    });
    const open = { available: 1n, usedUp: false };
    expect(closedReason({ endedAt: null, budget: open })).toBeNull();
    expect(closedReason({ endedAt: new Date(), budget: open })).toBe(ENDED_MESSAGE);
    expect(closedReason({ endedAt: null, budget: { available: 0n, usedUp: true } })).toBe(
      BUDGET_USED_UP_MESSAGE,
    );
  });
});

describe("out of funds", () => {
  it("blocks new submissions when the budget is used up, and reopens by itself after a deposit", async () => {
    vault = 10n * USDC;
    expect((await submit(post(1), { balanceOf })).ok).toBe(true);
    await approve(9n * USDC); // 1 USDC left: less than one point (2 USDC)
    expect(await programBudget(await program(), db, balanceOf)).toEqual({
      available: 1n * USDC,
      usedUp: true,
    });
    expect(await submit(post(2), { balanceOf })).toEqual({
      ok: false,
      error: BUDGET_USED_UP_MESSAGE,
    });
    expect(await db.select().from(submissions)).toHaveLength(1); // nothing recorded, nothing fetched
    vault = 30n * USDC; // the owner adds funds
    const again = await submit(post(2), { balanceOf });
    expect(again).toMatchObject({ ok: true });
  });

  it("doesn't block when the balance can't be read (the agent still won't auto-approve past it)", async () => {
    vault = null;
    expect((await submit(post(1), { balanceOf })).ok).toBe(true);
  });

  it("hides a used-up campaign's money from nobody: explore lists it with what's owed so the page can hide it", async () => {
    vault = 10n * USDC;
    await submit(post(1), { balanceOf });
    await approve(9n * USDC);
    const [c] = await openCampaigns("arc-testnet", db, NOW.getTime());
    expect(c).toMatchObject({
      slug: "arc-builders",
      approvedUnpaid: 9n * USDC,
      ratePerPoint: 2n * USDC,
    });
    expect(budgetOf({ balance: vault, ...c! }).usedUp).toBe(true);
  });
});

describe("end campaign", () => {
  it("stops new submissions and joins at once, hides it from explore, and opens no new round", async () => {
    vault = 100n * USDC;
    expect((await submit(post(1), { balanceOf })).ok).toBe(true);
    const res = await endProgram(db, { programId, userId: ownerId, now: NOW });
    expect(res).toMatchObject({ ok: true });
    expect(await program()).toMatchObject({ status: "active", endedAt: NOW });
    expect(
      (await db.select().from(auditEvents).where(eq(auditEvents.action, "program.ended"))).length,
    ).toBe(1);

    expect(await submit(post(2), { balanceOf })).toEqual({ ok: false, error: ENDED_MESSAGE });
    const bob = await upsertXUser(db, { id: "77", username: "bob" });
    expect(
      await linkContributorWallet(db, {
        programSlug: "arc-builders",
        user: bob,
        address: "0x00000000000000000000000000000000000000b2",
        nonce: "n2",
        issuedAt: new Date(),
        signature: "0x01",
        chainId: 5042002,
        verify: async () => true,
        consumeNonce: async () => true,
      }),
    ).toMatchObject({ ok: false, error: "program_ended" });
    expect(await openCampaigns("arc-testnet", db, NOW.getTime())).toEqual([]);

    // Round 1 runs to its end; nothing opens after it.
    const [r1] = await db.select().from(rounds).where(eq(rounds.programId, programId));
    expect(
      await ensureCurrentRound(db, await program(), new Date(r1!.endsAt.getTime() - 1)),
    ).toMatchObject({
      number: 1,
    });
    expect(
      await ensureCurrentRound(db, await program(), new Date(r1!.endsAt.getTime() + 1)),
    ).toBeNull();
    expect(await db.select().from(rounds).where(eq(rounds.programId, programId))).toHaveLength(1);
  });

  it("can't be undone by reopening joining, is idempotent, and isn't offered for drafts", async () => {
    await endProgram(db, { programId, userId: ownerId, now: NOW });
    expect(await setProgramStatus(db, { programId, userId: ownerId, status: "paused" })).toBe(
      false,
    );
    expect(await endProgram(db, { programId, userId: ownerId })).toMatchObject({
      ok: true,
      endedAt: NOW,
    });
    await db
      .update(programs)
      .set({ endedAt: null, status: "draft" })
      .where(eq(programs.id, programId));
    expect(await endProgram(db, { programId, userId: ownerId })).toMatchObject({ ok: false });
  });

  it("ending a paused campaign puts it back to active, so the worker still closes and pays its last round", async () => {
    await setProgramStatus(db, { programId, userId: ownerId, status: "paused" });
    await endProgram(db, { programId, userId: ownerId, now: NOW });
    expect(await program()).toMatchObject({ status: "active", endedAt: NOW });
  });
});
