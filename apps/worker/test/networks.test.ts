import { contributors, programs, rounds, submissions, users, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  processOverride,
  processSubmission,
  runRound,
  syncPayee,
  type RoundDeps,
} from "@misthos/agent";
import { depsFor, type WorkerDeps } from "../src/jobs";

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
const ids = { submission: "", contributor: "", round: "", program: "" };

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: `0x${"a".repeat(40)}` })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "main",
      name: "Main",
      description: "Mainnet program",
      ownerUserId: owner!.id,
      chain: "arc-mainnet",
      status: "active",
      rubricJson: { categories: [], generalRules: "" },
      ratePerPoint: 1n,
      limitsJson: {
        maxPerPayout: "1",
        maxPerRound: "1",
        maxPerDay: "1",
        autoApproveThreshold: "0",
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: "1",
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
      endsAt: new Date(Date.now() + 1e9),
    })
    .returning();
  const [u] = await db.insert(users).values({ xUserId: "1", xHandle: "a" }).returning();
  const [c] = await db
    .insert(contributors)
    .values({ programId: p!.id, userId: u!.id, xUserId: "1", xHandle: "a" })
    .returning();
  const [s] = await db
    .insert(submissions)
    .values({
      programId: p!.id,
      roundId: r!.id,
      contributorId: c!.id,
      url: "https://x.com/a/status/1",
      sourceType: "x_post",
      resourceId: "1",
    })
    .returning();
  Object.assign(ids, { submission: s!.id, contributor: c!.id, round: r!.id, program: p!.id });
});
afterEach(async () => ctx.client.close());

const testnet = { chainId: 5042002 } as unknown as RoundDeps;
const mainnet = { chainId: 5042 } as unknown as RoundDeps;
const worker = (have: Record<string, RoundDeps>): WorkerDeps =>
  ({
    ...testnet,
    db,
    networks: Object.keys(have),
    forChain: (key: string) => have[key] ?? null,
  }) as WorkerDeps;

describe("each job runs on its program's network", () => {
  it("submissions, payees and rounds of a mainnet program get the mainnet agent", async () => {
    const w = worker({ "arc-testnet": testnet, "arc-mainnet": mainnet });
    for (const [what, id] of [
      ["submission", ids.submission],
      ["contributor", ids.contributor],
      ["round", ids.round],
    ] as const)
      expect((await depsFor(w, what, id)).deps?.chainId).toBe(5042);
  });

  it("a testnet program stays on testnet", async () => {
    await db.update(programs).set({ chain: "arc-testnet" }).where(eq(programs.id, ids.program));
    const w = worker({ "arc-testnet": testnet, "arc-mainnet": mainnet });
    expect((await depsFor(w, "submission", ids.submission)).deps?.chainId).toBe(5042002);
  });

  it("no mainnet agent: the job is skipped, never run on the testnet agent", async () => {
    const w = worker({ "arc-testnet": testnet });
    for (const [what, id] of [
      ["submission", ids.submission],
      ["contributor", ids.contributor],
      ["round", ids.round],
    ] as const)
      expect(await depsFor(w, what, id)).toEqual({ deps: null, skip: "arc-mainnet" });
  });
});

describe("the agent refuses dependencies for another network (defense in depth)", () => {
  const never = () => {
    throw new Error("must not be called");
  };
  const wrong = {
    db,
    chainId: 5042002,
    signer: { kind: "eoa", address: `0x${"1".repeat(40)}`, signHash: never },
    executor: { kind: "eoa", address: `0x${"1".repeat(40)}`, send: never },
    reader: new Proxy({}, { get: () => never }),
    fetchers: new Proxy({}, { get: () => never }),
    judge: never,
  } as unknown as RoundDeps;

  it("testnet deps on a mainnet program: nothing is claimed, locked, signed or sent", async () => {
    const d = { ...wrong, db };
    await db
      .update(programs)
      .set({ vaultAddress: `0x${"f".repeat(40)}` })
      .where(eq(programs.id, ids.program));
    await db
      .update(contributors)
      .set({ walletAddress: `0x${"e".repeat(40)}`, walletVerifiedAt: new Date() })
      .where(eq(contributors.id, ids.contributor));
    expect(await processSubmission(d, ids.submission)).toEqual({
      status: "skipped",
      reason: "wrong_network",
    });
    expect(
      await processOverride(d, {
        submissionId: ids.submission,
        userId: ids.program,
        action: "reject",
        reason: "x",
      } as never),
    ).toEqual({ ok: false, error: "wrong_network" });
    expect(await syncPayee(d, ids.contributor)).toEqual({
      status: "skipped",
      reason: "wrong_network",
    });
    expect(await runRound(d, ids.round, { force: true })).toEqual({
      status: "skipped",
      reason: "wrong_network",
    });
    const [s] = await db.select().from(submissions).where(eq(submissions.id, ids.submission));
    expect(s!.status).toBe("pending");
    const [r] = await db.select().from(rounds).where(eq(rounds.id, ids.round));
    expect(r!.status).toBe("open");
  });

  it("mainnet deps on a testnet program are refused the same way", async () => {
    await db.update(programs).set({ chain: "arc-testnet" }).where(eq(programs.id, ids.program));
    expect(await processSubmission({ ...wrong, db, chainId: 5042 }, ids.submission)).toEqual({
      status: "skipped",
      reason: "wrong_network",
    });
  });
});
