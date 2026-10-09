import { auditEvents, contributors, programs, rounds, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { ProgramInput } from "@misthos/shared";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkContributorWallet, upsertWalletUser, upsertXUser } from "@/lib/server/contributors";
import { createProgram, getMembership, setProgramStatus } from "@/lib/server/programs";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
});
afterEach(async () => {
  await ctx.client.close();
});

const input = () =>
  ProgramInput.parse({
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
          description: "Original educational threads",
          sourceTypes: ["x_post"],
          maxPoints: 10,
          criteria: [{ key: "depth", name: "Depth", description: "Explains how it works" }],
        },
      ],
    },
    budget: {
      ratePerPoint: "2",
      roundLengthDays: "14",
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

async function setup(status: "draft" | "active" = "active") {
  const owner = await upsertWalletUser(db, "0x00000000000000000000000000000000000000AA");
  const r = await createProgram(db, {
    ownerUserId: owner.id,
    chain: "arc-testnet",
    input: input(),
  });
  if (!r.ok) throw new Error("create failed");
  if (status === "active")
    await setProgramStatus(db, { programId: r.programId, userId: owner.id, status: "active" });
  const user = await upsertXUser(db, { id: "42", username: "alice" });
  return { owner, programId: r.programId, user };
}

const accept = vi.fn(async () => true);
const link = (
  user: { id: string; xUserId: string; xHandle: string },
  over: Partial<Parameters<typeof linkContributorWallet>[1]> = {},
) =>
  linkContributorWallet(db, {
    programSlug: "arc-builders",
    user,
    address: "0x00000000000000000000000000000000000000B1",
    githubLogin: "alice-dev",
    nonce: "n1",
    issuedAt: new Date(),
    signature: "0x01" as Hex,
    chainId: 5042002,
    verify: accept,
    consumeNonce: accept,
    ...over,
  });

describe("createProgram", () => {
  it("creates draft program, owner membership, round 1 and an audit event atomically", async () => {
    const { owner, programId } = await setup("draft");
    const [p] = await db.select().from(programs).where(eq(programs.id, programId));
    expect(p).toMatchObject({
      slug: "arc-builders",
      status: "draft",
      ratePerPoint: 2_000_000n,
      isDemo: false,
    });
    expect(p!.limitsJson).toMatchObject({ maxPerPayout: "50000000", payeeCooldownSeconds: 86400 });
    expect(await getMembership(db, programId, owner.id)).toBe("owner");
    const [r] = await db.select().from(rounds).where(eq(rounds.programId, programId));
    expect(r!.endsAt.getTime() - r!.startsAt.getTime()).toBe(14 * 24 * 3600 * 1000);
    const events = await db.select().from(auditEvents);
    expect(events.map((e) => e.action)).toEqual(["program.created", "program.context_saved"]);
  });

  it("refuses a taken slug", async () => {
    const { owner } = await setup("draft");
    expect(
      await createProgram(db, { ownerUserId: owner.id, chain: "arc-testnet", input: input() }),
    ).toEqual({
      ok: false,
      error: "slug_taken",
    });
  });

  it("only lets the owner publish", async () => {
    const { programId, user } = await setup("draft");
    expect(await setProgramStatus(db, { programId, userId: user.id, status: "active" })).toBe(
      false,
    );
  });
});

describe("linkContributorWallet", () => {
  it('"Can\'t join": an X account below the minimums is turned away; one above them joins; members keep access', async () => {
    const { programId } = await setup();
    await db
      .update(programs)
      .set({ minXFollowers: 100, belowMinimum: "block" })
      .where(eq(programs.id, programId));
    const small = await upsertXUser(db, { id: "77", username: "small", followers: 40 });
    expect(await link(small)).toEqual({ ok: false, error: "below_minimum" });
    const big = await upsertXUser(db, { id: "78", username: "big", followers: 4000 });
    expect(
      await link(big, { address: "0x00000000000000000000000000000000000000B2" }),
    ).toMatchObject({ ok: true, joined: true });
    // Its followers drop later: still a member, can still change wallet (posts are then rejected by the agent).
    await upsertXUser(db, { id: "78", username: "big", followers: 10 });
    expect(
      await link(big, { address: "0x00000000000000000000000000000000000000B3" }),
    ).toMatchObject({ ok: true, joined: false });
    // "Send to my review" (the default) never blocks joining.
    await db.update(programs).set({ belowMinimum: "review" }).where(eq(programs.id, programId));
    expect(
      await link(small, { address: "0x00000000000000000000000000000000000000B4" }),
    ).toMatchObject({ ok: true, joined: true });
  });

  it("joins with a verified wallet and keeps the signed proof", async () => {
    const { user } = await setup();
    const verify = vi.fn(async (args: { message: string }) => args.message.length > 0);
    const r = await link(user, { verify });
    expect(r).toMatchObject({ ok: true, joined: true, walletChanged: false });
    const [c] = await db.select().from(contributors);
    // A typed GitHub username is never trusted; GitHub is only linked through OAuth.
    expect(c).toMatchObject({
      xUserId: "42",
      githubLogin: null,
      githubUserId: null,
      walletAddress: "0x00000000000000000000000000000000000000b1",
    });
    expect(c!.walletProofMessage).toBe(verify.mock.calls[0]![0].message);
    expect(c!.walletProofMessage).toContain("@alice (42)");
    expect(c!.walletChangedAt).toBeNull();
  });

  it("refuses programs that aren't published", async () => {
    const { user } = await setup("draft");
    expect(await link(user)).toEqual({ ok: false, error: "program_not_open" });
  });

  it("refuses bad signatures before consuming the nonce", async () => {
    const { user } = await setup();
    const consume = vi.fn(async () => true);
    expect(await link(user, { verify: async () => false, consumeNonce: consume })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("refuses replayed nonces and stale proofs", async () => {
    const { user } = await setup();
    expect(await link(user, { consumeNonce: async () => false })).toEqual({
      ok: false,
      error: "nonce_used",
    });
    expect(await link(user, { issuedAt: new Date(Date.now() - 11 * 60_000) })).toEqual({
      ok: false,
      error: "stale",
    });
  });

  it("records wallet changes for cooldown and alerts", async () => {
    const { user } = await setup();
    await link(user);
    const r = await link(user, { address: "0x00000000000000000000000000000000000000B2" });
    expect(r).toMatchObject({ ok: true, joined: false, walletChanged: true });
    const [c] = await db.select().from(contributors);
    expect(c!.walletChangedAt).not.toBeNull();
    const actions = (await db.select().from(auditEvents)).map((e) => e.action);
    expect(actions).toContain("contributor.wallet_changed");
  });

  it("refuses a wallet already used by another contributor in the program", async () => {
    const { user } = await setup();
    await link(user);
    const bob = await upsertXUser(db, { id: "43", username: "bob" });
    expect(await link(bob)).toEqual({ ok: false, error: "wallet_in_use" });
  });
});

describe("upsertXUser", () => {
  it("keys on the numeric X id and follows handle changes", async () => {
    const a = await upsertXUser(db, { id: "42", username: "alice" });
    const b = await upsertXUser(db, { id: "42", username: "alice_new" });
    expect(b.id).toBe(a.id);
    expect(b.xHandle).toBe("alice_new");
  });
});
