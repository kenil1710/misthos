import {
  auditEvents,
  contributors,
  decisions,
  payouts,
  programMembers,
  programs,
  rounds,
  submissions,
  users,
  type DbLike,
} from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { Rubric } from "@misthos/shared";
import { asc, eq } from "drizzle-orm";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChainError, type AgentExecutor } from "../src/chain/executor";
import { eoaSigner } from "../src/record";
import { contributorIdBytes32, roundIdBytes32 } from "../src/rounds/ids";
import { dueRounds, runRound, syncPayee, type RoundDeps } from "../src/rounds/job";
import type { Fetchers } from "../src/pipeline";
import type { Resource } from "../src/types";
import { FakeVault } from "./fake-vault";

const U = 1_000_000n;
const VAULT = "0x000000000000000000000000000000000000f00d" as Address;
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

let ctx: Awaited<ReturnType<typeof testDb>>;
let db: DbLike;
let programId: string;
let round1: string;
const people: Record<string, { id: string; xUserId: string; wallet: Address }> = {};
const deleted = new Set<string>();

const resourceFor = (id: string, authorId: string): Resource => ({
  sourceType: "x_post",
  resourceId: id,
  url: `https://x.com/i/web/status/${id}`,
  timestamp: "2026-10-06T00:00:00.000Z",
  timestampKind: "posted",
  title: null,
  text: "Arc pays gas in USDC.",
  author: { id: authorId, handle: "h", name: null, createdAt: null, followers: 10 },
  x: {
    isRepost: false,
    isReply: false,
    isQuote: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    quotes: 0,
    impressions: 10,
    lang: "en",
  },
});

/** Re-check fetcher: post id encodes its author ("<authorXid>-<n>"); ids in `deleted` are gone. */
const fetchers: Fetchers = {
  x: async (id) =>
    deleted.has(id)
      ? { outcome: { status: "not_found", detail: "The post was deleted." }, usage: [] }
      : {
          outcome: { status: "ok", resource: resourceFor(id, id.split("-")[0]!) },
          usage: [{ provider: "x", endpoint: "GET /2/tweets/:id", units: 1, estCostUsd: 0.015 }],
        },
  githubPr: async () => {
    throw new Error("unused");
  },
  githubCommit: async () => {
    throw new Error("unused");
  },
  article: async () => {
    throw new Error("unused");
  },
};

beforeEach(async () => {
  ctx = await testDb();
  db = ctx.db as unknown as DbLike;
  deleted.clear();
  const [owner] = await db
    .insert(users)
    .values({ walletAddress: "0x00000000000000000000000000000000000000aa" })
    .returning();
  const [p] = await db
    .insert(programs)
    .values({
      slug: "rounds",
      name: "Rounds",
      description: "Round tests",
      ownerUserId: owner!.id,
      chain: "arc-testnet",
      status: "active",
      vaultAddress: VAULT,
      rubricJson: RUBRIC,
      ratePerPoint: U,
      limitsJson: {
        maxPerPayout: String(5n * U),
        maxPerRound: String(12n * U),
        maxPerDay: String(50n * U),
        autoApproveThreshold: String(6n * U),
        payeeCooldownSeconds: 0,
        maxAutoApproveItem: String(5n * U),
      },
      autoApproveConfidence: 0.8,
      roundLengthDays: 7,
      firstRoundStartsAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning();
  programId = p!.id;
  await db.insert(programMembers).values({ programId, userId: owner!.id, role: "owner" });
  const [r] = await db
    .insert(rounds)
    .values({
      programId,
      number: 1,
      startsAt: new Date("2026-10-05T00:00:00Z"),
      endsAt: new Date("2026-10-12T00:00:00Z"),
    })
    .returning();
  round1 = r!.id;
  for (const [name, xid, w] of [
    ["alice", "1001", "a1"],
    ["bob", "1002", "b2"],
    ["carol", "1003", "c3"],
  ] as const) {
    const [u] = await db.insert(users).values({ xUserId: xid, xHandle: name }).returning();
    const wallet = `0x${w.padStart(40, "0")}` as Address;
    const [c] = await db
      .insert(contributors)
      .values({
        programId,
        userId: u!.id,
        xUserId: xid,
        xHandle: name,
        walletAddress: wallet,
        walletVerifiedAt: new Date(),
      })
      .returning();
    people[name] = { id: c!.id, xUserId: xid, wallet };
  }
});
afterEach(async () => {
  await ctx.client.close();
});

let n = 0;
/** An approved submission with a signed-looking agent decision. */
async function approved(who: keyof typeof people, amount: bigint, roundId = round1) {
  const person = people[who]!;
  const rid = `${person.xUserId}-${++n}`;
  const [s] = await db
    .insert(submissions)
    .values({
      programId,
      roundId,
      contributorId: person.id,
      url: `https://x.com/i/web/status/${rid}`,
      sourceType: "x_post",
      resourceId: rid,
      status: "approved",
      amount,
      createdAt: new Date(Date.UTC(2026, 9, 6, 0, n)),
    })
    .returning();
  const record = {
    schema: "misthos.decision/v1",
    submission: { id: s!.id },
    contributor: { wallet: person.wallet },
    round: {},
    flags: [],
    decision: { action: "approve", amount: String(amount) },
    decidedBy: { type: "agent" },
    summary: "ok",
    decidedAt: "2026-10-06T00:00:00Z",
  };
  await db.insert(decisions).values({
    submissionId: s!.id,
    flagsJson: [],
    action: "approve",
    amount,
    summary: "Approved.",
    decisionJson: JSON.stringify(record),
    decisionHash: keccak256(toBytes(`decision:${s!.id}`)),
    signature: "0x00",
    signerAddress: "0x0000000000000000000000000000000000000001",
    ruleVersion: "rules-v2",
    decidedBy: "agent",
  });
  return s!.id;
}

function deps(vault: FakeVault, executor: AgentExecutor = vault): RoundDeps {
  return {
    db,
    fetchers,
    judge: null,
    signer: eoaSigner(generatePrivateKey()),
    chainId: 5042002,
    reader: vault,
    executor,
    now: () => new Date("2026-10-12T00:00:01Z"),
  };
}
const fake = (o: Partial<FakeVault["lim"]> = {}, balance = 100n * U) =>
  new FakeVault(
    {
      maxPerPayout: 5n * U,
      maxPerRound: 12n * U,
      maxPerDay: 50n * U,
      autoApproveThreshold: 6n * U,
      payeeCooldown: 0n,
      ...o,
    },
    balance,
  );
const roundRow = async (id = round1) =>
  (await db.select().from(rounds).where(eq(rounds.id, id)))[0]!;
const actions = async () =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.createdAt))).map((a) => a.action);

describe("runRound", () => {
  it("closes, registers payees, proposes and auto-executes a round under the threshold", async () => {
    const v = fake();
    const s1 = await approved("alice", 2n * U);
    const s2 = await approved("alice", 1n * U);
    const s3 = await approved("bob", 2n * U);
    const out = await runRound(deps(v), round1);
    expect(out).toMatchObject({ status: "executed", total: 5n * U });
    expect(v.calls).toEqual(["registerPayee", "registerPayee", "proposeRound", "executeRound"]);
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(3n * U);
    expect(v.balances.get(people.bob!.wallet.toLowerCase())).toBe(2n * U);

    const r = await roundRow();
    expect(r).toMatchObject({
      status: "executed",
      totalAmount: 5n * U,
      roundIdBytes32: roundIdBytes32(round1),
    });
    expect(r.txHashPropose).toMatch(/^0x/);
    expect(r.txHashExecute).toMatch(/^0x/);
    const ps = await db.select().from(payouts).where(eq(payouts.roundId, round1));
    expect(ps.map((p) => [p.status, p.amount])).toEqual(
      expect.arrayContaining([
        ["executed", 3n * U],
        ["executed", 2n * U],
      ]),
    );
    for (const id of [s1, s2, s3])
      expect((await db.select().from(submissions).where(eq(submissions.id, id)))[0]!.status).toBe(
        "paid",
      );
    expect(await actions()).toEqual(
      expect.arrayContaining([
        "round.closed",
        "payee.registered",
        "round.planned",
        "round.proposed",
        "round.executed",
        "payout.executed",
      ]),
    );
    // round 2 was opened for new work
    expect(
      (await db.select().from(rounds).where(eq(rounds.programId, programId)))
        .map((x) => x.number)
        .sort(),
    ).toEqual([1, 2]);
    // running again is a no-op
    expect(await runRound(deps(v), round1)).toEqual({ status: "skipped", reason: "executed" });
    expect(v.calls.filter((c) => c === "executeRound")).toHaveLength(1);
  });

  it("waits for the owner above the threshold, then executes once approved on-chain", async () => {
    const v = fake();
    await approved("alice", 4n * U);
    await approved("bob", 4n * U);
    expect(await runRound(deps(v), round1)).toEqual({ status: "awaiting_approval", total: 8n * U });
    expect((await roundRow()).status).toBe("proposed");
    expect(await runRound(deps(v), round1)).toEqual({ status: "awaiting_approval", total: 8n * U }); // idempotent wait
    expect((await actions()).filter((a) => a === "round.awaiting_approval")).toHaveLength(1);
    v.approve(roundIdBytes32(round1));
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed", total: 8n * U });
    expect(v.calls.filter((c) => c === "proposeRound")).toHaveLength(1);
  });

  it("retries a transient failure without sending anything twice", async () => {
    const v = fake();
    await approved("alice", 2n * U);
    v.failNext = 1; // the first chain call (registerPayee) hiccups
    await expect(runRound(deps(v), round1)).rejects.toBeInstanceOf(ChainError);
    expect(await roundRow()).toMatchObject({
      status: "closed",
      lastError: expect.stringMatching(/transient/),
    });
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect(v.calls).toEqual(["registerPayee", "proposeRound", "executeRound"]);
  });

  it("recovers when the chain executed but the worker crashed before recording it", async () => {
    const v = fake();
    await approved("alice", 2n * U);
    let crash = true;
    const crashing: AgentExecutor = {
      ...v,
      kind: v.kind,
      address: v.address,
      send: async (call) => {
        const res = await v.send(call);
        if (crash && call.label.startsWith("executeRound")) {
          crash = false;
          throw new ChainError("worker died after sending", true);
        }
        return res;
      },
    };
    await expect(runRound(deps(v, crashing), round1)).rejects.toThrow(/worker died/);
    expect((await roundRow()).status).toBe("proposed");
    expect(await runRound(deps(v, crashing), round1)).toMatchObject({ status: "executed" });
    expect(v.calls.filter((c) => c === "executeRound")).toHaveLength(1); // same idempotency key → same tx
    expect(v.balances.get(people.alice!.wallet.toLowerCase())).toBe(2n * U);
  });

  it("opens the next round even if the worker died between closing this one and opening the next", async () => {
    const v = fake();
    await approved("alice", 2n * U);
    // Seen in live QA: the round was marked closed, then the worker was killed before round 2 existed.
    await db
      .update(rounds)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(rounds.id, round1));
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed" });
    expect(
      (await db.select().from(rounds).where(eq(rounds.programId, programId)))
        .map((x) => x.number)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("re-checks before paying: a deleted post is rejected with a signed payout-recheck decision", async () => {
    const v = fake();
    const keep = await approved("alice", 2n * U);
    const gone = await approved("bob", 2n * U);
    deleted.add(
      (await db.select().from(submissions).where(eq(submissions.id, gone)))[0]!.resourceId,
    );
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "executed", total: 2n * U });
    expect((await db.select().from(submissions).where(eq(submissions.id, keep)))[0]!.status).toBe(
      "paid",
    );
    expect((await db.select().from(submissions).where(eq(submissions.id, gone)))[0]!.status).toBe(
      "rejected",
    );
    const [last] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, gone))
      .orderBy(asc(decisions.createdAt))
      .then((d) => d.slice(-1));
    expect(JSON.parse(last!.decisionJson)).toMatchObject({
      rule: "R0_PAYOUT_RECHECK",
      decision: { action: "reject", amount: "0" },
    });
    expect(last!.summary).toMatch(/^Rejected at payout\. The post was deleted\./);
  });

  it("defers items over the per-payout cap to a later round instead of splitting them", async () => {
    const v = fake();
    await approved("alice", 3n * U);
    const over = await approved("alice", 3n * U); // 6 > maxPerPayout 5
    await runRound(deps(v), round1);
    expect((await db.select().from(submissions).where(eq(submissions.id, over)))[0]).toMatchObject({
      status: "approved",
      payoutId: null,
    });
    const planned = (await db.select().from(auditEvents)).find(
      (a) => a.action === "round.planned",
    )!;
    expect((planned.dataJson as { deferred: { reason: string }[] }).deferred).toEqual([
      { submissionId: over, reason: "per_payout_cap" },
    ]);
  });

  it("defers new payees in cooldown and pays them in a later round", async () => {
    const v = fake({ payeeCooldown: 3600n });
    const s = await approved("carol", 1n * U);
    expect(await runRound(deps(v), round1)).toEqual({ status: "nothing_to_pay" });
    expect((await db.select().from(submissions).where(eq(submissions.id, s)))[0]!.status).toBe(
      "approved",
    );
    v.time += 3600n;
    const [r2] = await db.select().from(rounds).where(eq(rounds.number, 2));
    const d = { ...deps(v), now: () => new Date("2026-10-19T00:00:01Z") };
    expect(await runRound(d, r2!.id)).toMatchObject({ status: "executed", total: 1n * U });
    expect(v.calls.filter((c) => c === "registerPayee")).toHaveLength(1);
  });

  it("marks the round failed and releases its items when the chain refuses", async () => {
    const v = fake({}, 1n * U); // vault underfunded
    const s = await approved("alice", 2n * U);
    expect(await runRound(deps(v), round1)).toMatchObject({ status: "failed" });
    expect(await roundRow()).toMatchObject({ status: "failed" });
    expect((await roundRow()).lastError).toMatch(/InsufficientBalance/);
    expect((await db.select().from(submissions).where(eq(submissions.id, s)))[0]).toMatchObject({
      status: "approved",
      payoutId: null,
    });
    expect((await db.select().from(payouts))[0]!.status).toBe("failed");
  });

  it("does nothing for a round that is still open unless forced (manual close)", async () => {
    const v = fake();
    await approved("alice", 1n * U);
    const early = { ...deps(v), now: () => new Date("2026-10-08T00:00:00Z") };
    expect(await runRound(early, round1)).toEqual({ status: "skipped", reason: "still_open" });
    expect(await runRound(early, round1, { force: true })).toMatchObject({ status: "executed" });
    expect((await roundRow()).endsAt).toEqual(new Date("2026-10-08T00:00:00Z"));
  });

  it("lists rounds that are due", async () => {
    expect(await dueRounds(db, new Date("2026-10-11T00:00:00Z"))).toEqual([]);
    expect(await dueRounds(db, new Date("2026-10-12T00:00:00Z"))).toEqual([{ id: round1 }]);
  });
});

describe("syncPayee", () => {
  it("registers once, then is a no-op; a wallet change re-registers (cooldown restarts on-chain)", async () => {
    const v = fake({ payeeCooldown: 86400n });
    expect(await syncPayee(deps(v), people.alice!.id)).toMatchObject({ status: "registered" });
    expect(await syncPayee(deps(v), people.alice!.id)).toEqual({ status: "unchanged" });
    const newWallet = `0x${"d4".padStart(40, "0")}`;
    await db
      .update(contributors)
      .set({ walletAddress: newWallet })
      .where(eq(contributors.id, people.alice!.id));
    v.time += 100n;
    expect(await syncPayee(deps(v), people.alice!.id)).toMatchObject({ status: "registered" });
    const p = v.payees.get(contributorIdBytes32(people.alice!.id))!;
    // viem decodes addresses checksummed; compare case-insensitively.
    expect([p.wallet.toLowerCase(), p.payableAfter]).toEqual([newWallet, v.time + 86400n]);
    expect((await actions()).filter((a) => a.startsWith("payee."))).toEqual([
      "payee.registered",
      "payee.changed",
    ]);
  });

  it("skips programs without a vault and unverified wallets", async () => {
    await db.update(programs).set({ vaultAddress: null });
    expect(await syncPayee(deps(fake()), people.alice!.id)).toEqual({ status: "skipped" });
  });
});
